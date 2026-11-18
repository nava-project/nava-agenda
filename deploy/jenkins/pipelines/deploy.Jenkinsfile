// Despliegue de producción de NAVA (DEC-177); sustituye a .github/workflows/deploy.yml.
//
// Promueve un commit de main que ya superó el CI; no hay ramas por ambiente
// (docs/03-desarrollo/flujo-git-github.md). Lo dispara el CI de main con AUTO=true
// (DEC-160) y una persona con un SHA para reintentar o volver atrás. Los controles
// posteriores son los de deploy.sh: respaldo verificado, simulación de migraciones y
// pruebas de humo; si alguno falla, la aplicación en ejecución no se toca.
//
// Las fases viven en deploy/jenkins/scripts/release.sh (del último main); las imágenes
// y lo que se envía al servidor salen de un worktree en el SHA a desplegar.
pipeline {
  agent any

  options {
    // Un solo despliegue a la vez y nunca se cancela uno en curso a medias.
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
  }

  // Propias de este pipeline (antes globales de JCasC). La infraestructura de Jenkins vive
  // en nava-project/nava-jenkins (DEC-184) y no guarda nada específico de Nava Agenda.
  environment {
    GITHUB_REPO = 'nava-project/nava-agenda'
    PUBLIC_URL = 'https://nava.wtf'
  }

  stages {
    stage('Verificar commit') {
      steps {
        withCredentials([usernamePassword(credentialsId: 'github-token', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
          sh 'deploy/jenkins/scripts/release.sh verify'
        }
        script {
          currentBuild.description = readFile('.release/summary').trim()
        }
      }
    }

    stage('Imágenes') {
      when { not { expression { fileExists('.release/skip') } } }
      steps {
        withCredentials([string(credentialsId: 'maps-browser-key', variable: 'VITE_GOOGLE_MAPS_BROWSER_KEY')]) {
          sh 'deploy/jenkins/scripts/release.sh images'
        }
      }
    }

    stage('Desplegar en el VPS') {
      when { not { expression { fileExists('.release/skip') } } }
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: 'vps-deploy-ssh', keyFileVariable: 'SSH_KEY')]) {
          sh 'deploy/jenkins/scripts/release.sh deploy'
        }
      }
    }

    stage('Comprobar HTTPS público') {
      when { not { expression { fileExists('.release/skip') } } }
      steps {
        sh 'deploy/jenkins/scripts/release.sh public-check'
      }
    }
  }
}
