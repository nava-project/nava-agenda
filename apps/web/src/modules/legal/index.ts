// Módulo: documentos legales públicos de NAVA (política de privacidad y
// condiciones del servicio). API pública mínima para `app`: las rutas,
// cargadas de forma diferida. Son páginas estáticas, sin sesión, sin llamadas
// al API y sin estado de negocio; sus componentes permanecen privados. Otros
// módulos las enlazan por su ruta (`/privacidad`, `/terminos`), nunca
// importando este módulo.
export { legalRoutes } from './routes'
