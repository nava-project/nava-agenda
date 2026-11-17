// CI de NAVA en Jenkins (DEC-177); sustituye a .github/workflows/ci.yml.
//
// Lo ejecuta el job multibranch barberia/ci de la VPS para cada PR contra main y cada
// commit de main, y publica el resultado como estado del commit en GitHub. Cada check
// corre en un contenedor de la imagen tools/ci/ci.Dockerfile (tools/ci/run.sh), con un
// PostgreSQL 14 efímero cuando lo necesita. En main, si todo pasa, construye las
// imágenes de la versión y dispara barberia/deploy con el mismo SHA (DEC-160).
//
// tools/ci/plan.sh decide antes qué checks hacen falta (#625): ninguno si el mismo árbol
// de git ya pasó un CI (p. ej. el squash-merge de un PR al día), y si no, los afectados por
// los archivos cambiados. Un check omitido aparece como «skipped» en la vista del build.
pipeline {
  agent any

  options {
    timeout(time: 60, unit: 'MINUTES')
    // Un commit nuevo de la misma rama o PR deja obsoleta la ejecución anterior.
    disableConcurrentBuilds(abortPrevious: true)
    buildDiscarder(logRotator(numToKeepStr: '30'))
  }

  stages {
    stage('Plan') {
      steps {
        sh 'tools/ci/plan.sh'
        script {
          currentBuild.description = readFile('.ci-plan/.summary').trim()
        }
      }
    }

    stage('Preparar') {
      when { expression { hasAnyCheck() } }
      steps {
        sh 'tools/ci/run.sh image'
        script {
          if (fileExists('.ci-plan/web')) {
            sh 'tools/ci/run.sh web-deps'
          }
        }
      }
    }

    // Todo en paralelo: los contenedores de prueba tienen prioridad de CPU baja frente a la
    // producción, y vitest tiene 10 s por prueba porque comparte CPU (tools/ci/checks/web-test.sh).
    stage('Checks') {
      when { expression { hasAnyCheck() } }
      parallel {
        stage('Frontend: pruebas') {
          when { expression { fileExists('.ci-plan/web') } }
          steps { sh 'tools/ci/run.sh web-test' }
        }
        stage('Frontend: formato, lint, tipos y build') {
          when { expression { fileExists('.ci-plan/web') } }
          steps { sh 'tools/ci/run.sh web-static' }
        }
        stage('Go (build, vet, test -race, govulncheck)') {
          when { expression { fileExists('.ci-plan/go') } }
          steps { sh 'tools/ci/run.sh go --postgres' }
        }
        stage('OpenAPI (lint + bundle)') {
          when { expression { fileExists('.ci-plan/openapi') } }
          steps { sh 'tools/ci/run.sh openapi' }
        }
        stage('Atlas + suites SQL contra el esquema aplicado') {
          when { expression { fileExists('.ci-plan/database') } }
          steps { sh 'tools/ci/run.sh database --postgres' }
        }
        stage('Despliegue (shellcheck y compose)') {
          when { expression { fileExists('.ci-plan/deploy') } }
          steps {
            sh 'tools/ci/run.sh shellcheck'
            sh 'tools/ci/compose-check.sh'
          }
        }
      }
    }

    // Después de los checks y no en paralelo: BuildKit no hereda la prioridad baja de
    // los contenedores de prueba y competiría con la producción por la CPU. En main
    // siempre: el despliegue necesita las imágenes de este SHA (si ya existen, no se
    // reconstruyen).
    stage('Imágenes (backend, web, base)') {
      when { expression { env.BRANCH_NAME == 'main' || fileExists('.ci-plan/images') } }
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
      sh 'tools/ci/plan.sh record'
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

// Hay al menos un check que correr según tools/ci/plan.sh. Bucle explícito: un paso de
// pipeline (fileExists) no puede ir dentro de un closure de `any`.
def hasAnyCheck() {
  for (String check : ['go', 'openapi', 'database', 'deploy', 'web']) {
    if (fileExists(".ci-plan/${check}")) {
      return true
    }
  }
  return false
}
