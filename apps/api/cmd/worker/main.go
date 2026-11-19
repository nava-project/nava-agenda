// Command worker arranca el proceso trabajador que enviará recordatorios ya
// persistidos. Reutiliza servicios y repositorios de los módulos, no
// handlers HTTP, según nava-docs/agenda/04-arquitectura/stack-despliegue-operacion.md.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nava-agenda/internal/modules/appointmentnotice"
	appointmentnoticepostgres "nava-agenda/internal/modules/appointmentnotice/postgres"
	"nava-agenda/internal/modules/auth"
	authpostgres "nava-agenda/internal/modules/auth/postgres"
	customeraccesspostgres "nava-agenda/internal/modules/customeraccess/postgres"
	"nava-agenda/internal/modules/googlecalendar"
	googlecalendargoogle "nava-agenda/internal/modules/googlecalendar/google"
	googlecalendarpostgres "nava-agenda/internal/modules/googlecalendar/postgres"
	"nava-agenda/internal/modules/notification"
	notificationpostgres "nava-agenda/internal/modules/notification/postgres"
	"nava-agenda/internal/modules/retention"
	retentionpostgres "nava-agenda/internal/modules/retention/postgres"
	"nava-agenda/internal/platform/clock"
	"nava-agenda/internal/platform/config"
	"nava-agenda/internal/platform/database"
	"nava-agenda/internal/platform/observability"
)

// purgeInterval es la cadencia del lote de purga de HU-007
// (login_throttle/auth_phone_challenge, CA-007-06). No es un valor
// aprobado por ninguna decisión normativa (ninguna fuente fija una
// cadencia, solo el tamaño del lote vía config.Config); 5 minutos es
// razonable para tablas de retención corta (horas/días) sin generar carga
// perceptible.
const purgeInterval = 5 * time.Minute

// retentionInterval es la cadencia de la anonimización de clientes vencidos
// (DEC-185). El plazo se mide en meses, así que un día de retraso no cambia
// nada; la pasada también corre al arrancar, y el worker arranca en cada
// despliegue.
const retentionInterval = 24 * time.Hour

func main() {
	if err := run(); err != nil {
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := observability.NewLogger(cfg.LogLevel)

	// El worker se conecta como agenda_worker (cfg.WorkerDatabaseURL), NO
	// como cfg.DatabaseURL (esa es la credencial del proceso api): DEC-040
	// exige roles separados, y config.Load ya rechaza que ambas URLs sean
	// iguales fuera de local/test. WorkerDatabaseURL solo puede llegar vacío
	// en local/test (Load lo exige en cualquier otro ambiente); ahí se
	// reutiliza la URL del api para no exigir una segunda variable en
	// desarrollo local.
	workerDSN := cfg.WorkerDatabaseURL
	if workerDSN == "" {
		workerDSN = cfg.DatabaseURL
	}
	db, err := database.NewDB(workerDSN, cfg)
	if err != nil {
		logger.Error("no se pudo iniciar el pool de base de datos")
		return errors.New("database: fallo al iniciar el pool")
	}
	defer db.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// HU-007/HU-008 (CA-007-06, DEC-064): purga en lote de login_throttle,
	// auth_phone_challenge y staff_recovery_code, exclusiva de
	// agenda_worker (DDL-AUT-01, DEC-040). El reclamo de recordatorios
	// con SKIP LOCKED, el envío por canal y los reintentos se agregan junto
	// con la maquinaria general de notificaciones de B5, según
	// nava-docs/agenda/05-backend/estandar-base-datos.md.
	purgeService := auth.NewPurgeService(
		authpostgres.NewPurgeRepository(db),
		cfg.LoginThrottlePurgeLimit,
		cfg.PhoneChallengePurgeLimit,
		cfg.RecoveryCodePurgeLimit,
	)

	// Issue #355 (DEC-126): purga de ventanas vencidas y estados de entrega de
	// WhatsApp. Sin webhook configurado las tablas están vacías y el lote no
	// borra nada.
	whatsAppPurge := notification.NewWhatsAppPurgeService(
		notificationpostgres.NewWhatsAppPurgeRepository(db), cfg.PhoneChallengePurgeLimit,
	)

	// HU-105 (DEC-178): purga de los retos de acceso al turno vencidos.
	customerAccessPurge := customeraccesspostgres.NewPurgeRepository(db)

	// Issue #693 (DEC-185): anonimización de los clientes 24 meses después de su
	// última actividad, como promete la política de privacidad.
	go runRetention(ctx, retention.NewService(retentionpostgres.NewRepository(db)), logger)

	// Issue #324 (DEC-102): publicación en Google Calendar. Con las credenciales
	// ausentes el worker sigue purgando y la integración queda desactivada.
	if cfg.GoogleCalendarEnabled() {
		publisher, err := buildGoogleCalendarPublisher(db, logger, cfg)
		if err != nil {
			logger.Error("no se pudo iniciar el publicador de Google Calendar")
			return err
		}
		go publisher.Run(ctx)
		logger.Info("worker: publicación en Google Calendar activa")
	} else if cfg.GoogleCalendarPartiallyConfigured() {
		logger.Warn("google_calendar.config.incomplete",
			"detail", "faltan variables GOOGLE_CALENDAR_*; la publicación queda desactivada")
	}

	// HU-130 (DEC-142): avisos al cliente cuando el profesional cancela o reprograma.
	// Reutiliza las credenciales de Resend del resto de correos; sin ellas el
	// worker sigue purgando y los avisos esperan en la cola hasta configurarlas.
	if cfg.ResendAPIKey != "" && cfg.ResendFromAddress != "" {
		dispatcher := appointmentnotice.NewDispatcher(appointmentnotice.Deps{
			Store: appointmentnoticepostgres.NewWorkerRepository(db),
			Mailer: notification.NewResendChangeNoticeSender(notification.ResendChangeNoticeConfig{
				APIKey: cfg.ResendAPIKey, FromAddress: cfg.ResendFromAddress,
			}, nil),
			WhatsApp: buildWhatsAppReminderSender(cfg, logger),
			Clock:    clock.System{},
			Config:   appointmentnotice.DefaultConfig(),
			Logger:   logger,
		})
		go dispatcher.Run(ctx)
		logger.Info("worker: avisos de cambio de turno activos")
	} else {
		logger.Warn("appointment_notice.config.incomplete",
			"detail", "faltan APP_RESEND_API_KEY y APP_RESEND_FROM_ADDRESS; los avisos de cambio de turno quedan en cola")
	}

	logger.Info("worker iniciado", "environment", cfg.Environment, "purge_interval", purgeInterval.String())

	ticker := time.NewTicker(purgeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("worker apagado")
			return nil
		case <-ticker.C:
			if whatsAppDeleted, err := whatsAppPurge.PurgeOnce(ctx); err != nil {
				logger.Error("worker: fallo al purgar los datos del webhook de WhatsApp")
			} else if whatsAppDeleted > 0 {
				logger.Info("worker: purga de WhatsApp completada", "whatsapp_deleted", whatsAppDeleted)
			}
			if accessDeleted, err := customerAccessPurge.PurgeExpiredChallenges(ctx, cfg.PhoneChallengePurgeLimit); err != nil {
				logger.Error("worker: fallo al purgar customer_access_challenge")
			} else if accessDeleted > 0 {
				logger.Info("worker: purga de retos de acceso completada", "customer_access_deleted", accessDeleted)
			}
			loginThrottleDeleted, phoneChallengeDeleted, recoveryCodeDeleted, err := purgeService.PurgeOnce(ctx)
			if err != nil {
				logger.Error("worker: fallo al purgar login_throttle/auth_phone_challenge/staff_recovery_code")
				continue
			}
			if loginThrottleDeleted > 0 || phoneChallengeDeleted > 0 || recoveryCodeDeleted > 0 {
				logger.Info("worker: purga completada",
					"login_throttle_deleted", loginThrottleDeleted,
					"phone_challenge_deleted", phoneChallengeDeleted,
					"recovery_code_deleted", recoveryCodeDeleted,
				)
			}
		}
	}
}

// runRetention corre una pasada de anonimización al arrancar y otra cada
// retentionInterval. Solo registra conteos: nunca datos del cliente (RN-DAT-02).
func runRetention(ctx context.Context, svc *retention.Service, logger *slog.Logger) {
	ticker := time.NewTicker(retentionInterval)
	defer ticker.Stop()
	for {
		anonymized, err := svc.RunOnce(ctx)
		switch {
		case ctx.Err() != nil:
			return
		case err != nil:
			logger.Error("worker: fallo en la anonimización de clientes vencidos", "customers_anonymized", anonymized)
		case anonymized > 0:
			logger.Info("worker: anonimización de clientes vencidos completada", "customers_anonymized", anonymized)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// buildGoogleCalendarPublisher arma el publicador de Google Calendar. db es el
// pool del worker (agenda_worker): solo ejecuta las funciones de reclamo y
// finalización (DEC-040, DEC-102).
func buildGoogleCalendarPublisher(db *database.DB, logger *slog.Logger, cfg config.Config) (*googlecalendar.Publisher, error) {
	cipher, err := googlecalendar.NewCipherFromKeys(cfg.GoogleCalendarTokenKeyID,
		cfg.GoogleCalendarTokenEncryptionKey, cfg.GoogleCalendarPreviousKeys)
	if err != nil {
		return nil, errors.New("googlecalendar: fallo al iniciar el cifrador")
	}
	return googlecalendar.NewPublisher(googlecalendar.PublisherDeps{
		Store: googlecalendarpostgres.NewWorkerRepository(db),
		API:   googlecalendargoogle.NewEventsClient("", nil),
		Provider: googlecalendargoogle.New(googlecalendargoogle.Config{
			ClientID:     cfg.GoogleCalendarClientID,
			ClientSecret: cfg.GoogleCalendarClientSecret,
			RedirectURL:  cfg.GoogleCalendarRedirectURI,
		}),
		Cipher: cipher,
		Clock:  clock.System{},
		Config: googlecalendar.DefaultPublisherConfig(),
		Logger: logger,
	}), nil
}

// buildWhatsAppReminderSender arma el envío del recordatorio por WhatsApp
// (DEC-175) con el mismo número emisor y token del código de acceso. Sin ellos
// devuelve nil y el despachador cierra esos recordatorios como omitidos
// (`channel_unavailable`), sin bloquear los de correo.
func buildWhatsAppReminderSender(cfg config.Config, logger *slog.Logger) appointmentnotice.WhatsAppReminderSender {
	if cfg.MetaWhatsAppPhoneNumberID == "" || cfg.MetaWhatsAppAccessToken == "" {
		logger.Warn("appointment_notice.whatsapp.disabled",
			"detail", "faltan APP_META_WHATSAPP_PHONE_NUMBER_ID o APP_META_WHATSAPP_ACCESS_TOKEN; el recordatorio sale solo por correo")
		return nil
	}
	meta := notification.NewMetaWhatsAppSender(notification.MetaWhatsAppConfig{
		APIVersion:     cfg.MetaWhatsAppAPIVersion,
		PhoneNumberID:  cfg.MetaWhatsAppPhoneNumberID,
		AccessToken:    cfg.MetaWhatsAppAccessToken,
		Mode:           notification.MetaModeTemplate,
		TestRecipients: cfg.MetaWhatsAppTestRecipients,
		Logger:         logger,
	}, nil)
	logger.Info("worker: recordatorios por WhatsApp activos", "template", cfg.MetaWhatsAppReminderTemplateName)
	return notification.NewMetaReminderSender(meta, notification.MetaReminderConfig{
		TemplateName: cfg.MetaWhatsAppReminderTemplateName,
		LanguageCode: cfg.MetaWhatsAppReminderLanguageCode,
	})
}
