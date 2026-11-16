// CI de NAVA en Jenkins (DEC-177); sustituye a .github/workflows/ci.yml.
//
// Lo ejecuta el job multibranch barberia/ci de la VPS para cada PR contra main y cada
// commit de main, y publica el resultado como estado del commit en GitHub. Cada check
// corre en un contenedor de la imagen tools/ci/ci.Dockerfile (tools/ci/run.sh), con un
// PostgreSQL 14 efímero cuando lo necesita. En main, si todo pasa, construye las
// imágenes de la versión y dispara barberia/deploy con el mismo SHA (DEC-160).
pipeline {
  agent any

  options {
    timeout(time: 60, unit: 'MINUTES')
    // Un commit nuevo de la misma rama o PR deja obsoleta la ejecución anterior.
    disableConcurrentBuilds(abortPrevious: true)
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }

  stages {
    stage('Imagen de herramientas') {
      steps {
        sh 'tools/ci/run.sh image'
      }
    }

    stage('Checks') {
      parallel {
        stage('Go (build, vet, test -race, govulncheck)') {
          steps { sh 'tools/ci/run.sh go --postgres' }
        }
        stage('OpenAPI (lint + bundle)') {
          steps { sh 'tools/ci/run.sh openapi' }
        }
        stage('Frontend (lint, tipos, pruebas, build)') {
          steps { sh 'tools/ci/run.sh web' }
        }
        stage('Atlas + suites SQL contra el esquema aplicado') {
          steps { sh 'tools/ci/run.sh database --postgres' }
        }
        stage('Despliegue (shellcheck y compose)') {
          steps {
            sh 'tools/ci/run.sh shellcheck'
            sh 'tools/ci/compose-check.sh'
          }
        }
      }
    }

    // Después de los checks y no en paralelo: BuildKit no hereda la prioridad baja de
    // los contenedores de prueba y competiría con la producción por la CPU.
    stage('Imágenes (backend, web, base)') {
      steps {
        withCredentials([string(credentialsId: 'maps-browser-key', variable: 'VITE_GOOGLE_MAPS_BROWSER_KEY')]) {
          sh '''
            if [ "$BRANCH_NAME" = main ]; then
              tools/ci/build-images.sh release . "$GIT_COMMIT"
            else
              tools/ci/build-images.sh check .
            fi
          '''
        }
      }
    }
  }

  post {
    success {
      script {
        if (env.BRANCH_NAME == 'main') {
          build job: '/barberia/deploy', wait: false, parameters: [
            string(name: 'SHA', value: env.GIT_COMMIT),
            booleanParam(name: 'AUTO', value: true),
          ]
        }
      }
    }
  }
}
