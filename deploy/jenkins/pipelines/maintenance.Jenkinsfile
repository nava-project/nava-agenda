// Mantenimiento diario del Docker de la VPS (DEC-177). Afecta a todos los proyectos:
// solo borra lo que ningún contenedor usa y lo que el CI dejó atrás.
pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
  }

  stages {
    stage('Contenedores de CI huérfanos') {
      steps {
        // Un check dura como máximo 60 min (timeout del CI): uno de más de 3 h quedó huérfano.
        sh '''
          limit=$(( $(date +%s) - 3 * 3600 ))
          docker ps -aq --filter label=nava-ci=1 | while read -r id; do
            created=$(date -d "$(docker inspect -f '{{.Created}}' "$id")" +%s)
            if [ "$created" -lt "$limit" ]; then docker rm -f -v "$id"; fi
          done
        '''
      }
    }
    stage('Caché de construcción e imágenes colgantes') {
      steps {
        sh '''
          docker builder prune -f --filter until=168h
          docker image prune -f
        '''
      }
    }
    stage('Uso de disco') {
      steps {
        sh 'docker system df; df -h /srv/jenkins/home'
      }
    }
  }
}
