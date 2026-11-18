# testdata

Escenarios controlados para pruebas de integración y volumen (por ejemplo,
datos representativos para revisar planes de consulta), según
[`docs/05-backend/estandar-base-datos.md`](../../docs/05-backend/estandar-base-datos.md)
sección 2.

| Archivo | Escenario |
| --- | --- |
| `dos_negocios.sql` | Dos negocios con usuarios propios (HU-001, aislamiento RLS) |
| `notification_lease_fixture.sql` | Profesional, servicio, cliente y cita fijos para `tests/notification_lease_concurrency*.sql` (issue #5) |
| `customer_anonymization_fixture.sql` | Profesional y servicio fijos por negocio para `tests/customer_anonymization.sql` (issue #6) |
| `rls_suite_fixture.sql` | Una fila por tabla protegida por RLS, en ambos negocios, para `tests/rls_suite.sql` (issue #7) |

| `ui_bloqueos_profesionales_286.sql` | Dos negocios y usuarios sintéticos dedicados al E2E de integración de bloqueos en Profesionales (#286). Aplicar únicamente en BD local de pruebas con rol migrador; incluye hashes argon2id reales de una contraseña ficticia documentada. |

- `ui_paginacion_profesionales_288.sql`: dos tenants dedicados para el E2E de paginación numerada de Profesionales (#288), con 17 y 3 personas sintéticas. Solo entorno local/test; no aplicar en producción.
- `ui_profesional_individual_294.sql`: un negocio con UN solo profesional, perfil `solo`, cuatro servicios (tres ya ofrecidos), horario de lunes a sábado y tres turnos de hoy, para ver y probar el perfil de profesional individual (#294, `DEC-115`). Cuenta ficticia `mateo.demo@ejemplo.test` con la contraseña de desarrollo documentada en el archivo (hash argon2id real). Repetible: recrea los turnos de hoy. Solo entorno local/test; no aplicar en producción.
- `dec162_agregados_publicos.sql`: dos negocios dedicados a los agregados públicos de solo lectura (`DEC-162`): profesionales con y sin asignación, servicio activo, inactivo y sin profesionales, y jornada de 7 días. Alimenta `publicbooking/postgres` y `cmd/api`. Solo entorno local/test; repetible (`ON CONFLICT DO NOTHING`).
