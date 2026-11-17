import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      setupFiles: ['./vitest.setup.ts'],
      // Las pruebas son herméticas: una clave de navegador de Google en el
      // `.env.local` de quien desarrolla no debe sacar el mapa y el autocompletado
      // del modo simulado que asumen (DEC-130, DEC-131).
      env: { VITE_GOOGLE_MAPS_BROWSER_KEY: '' },
      // Preempaqueta las dependencias (Vue, axe-core…) una vez, como hace Vite en el
      // navegador, en lugar de transformarlas archivo a archivo en cada uno de los 170
      // archivos de prueba: la suite completa baja de 186 s a 137 s sin cambiar ninguna
      // prueba (#625).
      deps: { optimizer: { web: { enabled: true } } },
    },
  }),
)
