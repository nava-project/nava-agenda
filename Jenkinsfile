// CI de NAVA en Jenkins (DEC-177); sustituye a .github/workflows/ci.yml.
//
// Lo ejecuta el job multibranch agenda/ci de la VPS para cada PR contra main y cada
// commit de main, y publica el resultado como estado del commit en GitHub. Cada check
// corre en un contenedor de la imagen tools/ci/ci.Dockerfile (tools/ci/run.sh), con un
// PostgreSQL 14 efímero cuando lo necesita. En main, si todo pasa, construye las
// imágenes de la versión y dispara agenda/deploy con el mismo SHA (DEC-160).
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

    // Plan de Pruebas PP-NAVA-001 (Ingeniería de Software III, #784): las pruebas
    // unitarias dedicadas a cada caso CP. Sin `when`: corre siempre, aunque plan.sh no
    // pida ningún check (árbol ya verificado). Va antes que el resto y no en paralelo: si
    // una prueba CP falla, el build se detiene y no hay checks, imágenes ni despliegue.
    stage('Pruebas unitarias · Plan de Pruebas (CP)') {
      steps {
        sh 'tools/ci/run.sh image'
        sh 'tools/ci/run.sh web-deps'
        sh 'tools/ci/run.sh plan-pruebas'
      }
      post {
        always {
          archiveArtifacts allowEmptyArchive: true, artifacts: 'reports/plan-pruebas/**'
          // La vista «Test Results» necesita el plugin junit. El Jenkins local de
          // tools/ci/local lo trae; si un controlador no lo tiene, los XML quedan
          // archivados igual y el build no cambia de resultado por eso.
          script {
            try {
              junit allowEmptyResults: true, testResults: 'reports/plan-pruebas/*-junit.xml'
            } catch (NoSuchMethodError ignored) {
              echo 'Plugin junit no instalado: los reportes JUnit quedan solo como artefactos.'
            }
          }
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
        stage('Frontend: formato, lint y tipos') {
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
    // reconstruyen). La imagen web ejecuta `pnpm run build`: es el check del build del
    // frontend.
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

    // Solo en el Jenkins LOCAL de evaluación (tools/ci/local, NAVA_ENTORNO=local): las
    // etapas que en la VPS hace el job agenda/deploy. En la VPS no aparecen. Llegar aquí
    // exige que todo lo anterior esté en verde.
    stage('Desplegar (aprobación manual)') {
      when {
        allOf {
          environment name: 'NAVA_ENTORNO', value: 'local'
          expression { params.DESPLEGAR == true }
        }
      }
      steps {
        input message: '¿Aprobar el despliegue de este commit?', ok: 'Aprobar'
        echo 'Aprobado. En local no hay servidor ni credenciales: el despliegue se omite. En la VPS lo hace agenda/deploy (respaldo, migraciones Atlas y docker compose up).'
      }
    }

    stage('Smoke') {
      when {
        allOf {
          environment name: 'NAVA_ENTORNO', value: 'local'
          expression { params.DESPLEGAR == true }
        }
      }
      steps {
        echo 'Sin despliegue en local: el smoke se omite. En la VPS comprueba /health y la portada por HTTPS público.'
      }
    }

    stage('Limpieza') {
      when { environment name: 'NAVA_ENTORNO', value: 'local' }
      steps {
        // Contenedores de checks huérfanos de ESTE build (run.sh los nombra con BUILD_TAG)
        // e imágenes colgantes que dejó el pipeline.
        sh '''
          docker ps -aq --filter label=nava-ci=1 --filter "name=nava-ci-${BUILD_TAG}-" | xargs -r docker rm -f -v
          docker image prune -f --filter label=org.opencontainers.image.revision
        '''
      }
    }
  }

  post {
    success {
      sh 'tools/ci/plan.sh record'
      script {
        if (env.BRANCH_NAME == 'main') {
          build job: '/agenda/deploy', wait: false, parameters: [
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
