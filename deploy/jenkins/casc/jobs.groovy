// Jobs del Jenkins de la VPS (DEC-177), como código (Job DSL). Una carpeta por proyecto;
// cada proyecto trae sus Jenkinsfiles en su propio repositorio.

def repoUrl = 'https://github.com/bcaceres19/nava-agenda'

folder('agenda') {
  displayName('Nava Agenda')
  description("Repositorio ${repoUrl}")
}

// CI: cada PR contra main y cada commit de main (equivale al antiguo ci.yml). El estado se
// publica en el commit de GitHub. En main, si pasa, dispara agenda/deploy.
multibranchPipelineJob('agenda/ci') {
  displayName('CI')
  description('Checks de Go, OpenAPI, frontend, base de datos y despliegue. Jenkinsfile en la raíz del repo.')
  branchSources {
    branchSource {
      source {
        github {
          id('nava-agenda-github')
          repoOwner('bcaceres19')
          repository('nava-agenda')
          repositoryUrl("${repoUrl}.git")
          configuredByUrl(false)
          credentialsId('github-token')
          traits {
            // 1 = ramas que no son también PR; 1 = PR fusionado con su base (como
            // pull_request en GitHub Actions).
            gitHubBranchDiscovery { strategyId(1) }
            gitHubPullRequestDiscovery { strategyId(1) }
            // Solo main y los PR: las ramas sin PR no se construyen (como antes).
            headWildcardFilter {
              includes('main PR-*')
              excludes('')
            }
          }
        }
      }
    }
  }
  factory {
    workflowBranchProjectFactory { scriptPath('Jenkinsfile') }
  }
  orphanedItemStrategy {
    discardOldItems {
      daysToKeep(14)
      numToKeep(30)
    }
  }
  // Respaldo del webhook: si un evento de GitHub no llega, el escaneo lo encuentra.
  triggers {
    periodicFolderTrigger { interval('5m') }
  }
}

// Deploy: lo dispara el CI de main con el SHA probado (AUTO=true) o una persona para
// reintentar o volver a un SHA anterior de main (AUTO=false).
pipelineJob('agenda/deploy') {
  displayName('Deploy')
  description('Despliega un SHA de main en la VPS: imágenes, respaldo, migraciones, arranque y humo.')
  parameters {
    stringParam('SHA', '', 'SHA de main a desplegar (vacío = último commit de main).')
    booleanParam('AUTO', false, 'Lo marca el CI. Si main ya avanzó, se omite este despliegue.')
  }
  logRotator { numToKeep(60) }
  definition {
    cpsScm {
      scm {
        git {
          remote {
            url("${repoUrl}.git")
            credentials('github-token')
          }
          branch('*/main')
        }
      }
      scriptPath('deploy/jenkins/pipelines/deploy.Jenkinsfile')
      lightweight(true)
    }
  }
}

// ---------------------------------------------------------------------------------------
// Nava · Pedidos (bcaceres19/nava-pedidos, /srv/pedidos). Mismo patrón que agenda/: el
// Jenkinsfile y deploy/jenkins/deploy.Jenkinsfile viven en su propio repositorio.

def pedidosUrl = 'https://github.com/bcaceres19/nava-pedidos'

folder('pedidos') {
  displayName('Pedidos (bandeja)')
  description("Repositorio ${pedidosUrl}")
}

multibranchPipelineJob('pedidos/ci') {
  displayName('CI')
  description('npm test con PostgreSQL 16, shellcheck, compose de producción e imagen. Jenkinsfile en la raíz del repo.')
  branchSources {
    branchSource {
      source {
        github {
          id('pedidos-github')
          repoOwner('bcaceres19')
          repository('nava-pedidos')
          repositoryUrl("${pedidosUrl}.git")
          configuredByUrl(false)
          credentialsId('github-token')
          traits {
            gitHubBranchDiscovery { strategyId(1) }
            gitHubPullRequestDiscovery { strategyId(1) }
            headWildcardFilter {
              includes('main PR-*')
              excludes('')
            }
          }
        }
      }
    }
  }
  factory {
    workflowBranchProjectFactory { scriptPath('Jenkinsfile') }
  }
  orphanedItemStrategy {
    discardOldItems {
      daysToKeep(14)
      numToKeep(30)
    }
  }
  triggers {
    periodicFolderTrigger { interval('5m') }
  }
}

pipelineJob('pedidos/deploy') {
  displayName('Deploy')
  description('Despliega un SHA de main en /srv/pedidos: imagen, respaldo, arranque, salud por edge y https://pedidos.nava.wtf/healthz.')
  parameters {
    stringParam('SHA', '', 'SHA de main a desplegar (vacío = último commit de main).')
    booleanParam('AUTO', false, 'Lo marca el CI. Si main ya avanzó, se omite este despliegue.')
  }
  logRotator { numToKeep(60) }
  definition {
    cpsScm {
      scm {
        git {
          remote {
            url("${pedidosUrl}.git")
            credentials('github-token')
          }
          branch('*/main')
        }
      }
      scriptPath('deploy/jenkins/deploy.Jenkinsfile')
      lightweight(true)
    }
  }
}

// ---------------------------------------------------------------------------------------
// Nava · Landing (bcaceres19/nava, /srv/nava; DEC-183). La landing de la familia NAVA y
// sus documentos legales, servidos en nava.wtf. Mismo patrón que agenda/: el Jenkinsfile
// y deploy/jenkins/deploy.Jenkinsfile viven en su propio repositorio.

def navaUrl = 'https://github.com/bcaceres19/nava'

folder('nava') {
  displayName('Nava (landing)')
  description("Repositorio ${navaUrl}")
}

multibranchPipelineJob('nava/ci') {
  displayName('CI')
  description('Typecheck, lint, formato, vitest, build, shellcheck e imagen. Jenkinsfile en la raíz del repo.')
  branchSources {
    branchSource {
      source {
        github {
          id('nava-github')
          repoOwner('bcaceres19')
          repository('nava')
          repositoryUrl("${navaUrl}.git")
          configuredByUrl(false)
          credentialsId('github-token')
          traits {
            gitHubBranchDiscovery { strategyId(1) }
            gitHubPullRequestDiscovery { strategyId(1) }
            headWildcardFilter {
              includes('main PR-*')
              excludes('')
            }
          }
        }
      }
    }
  }
  factory {
    workflowBranchProjectFactory { scriptPath('Jenkinsfile') }
  }
  orphanedItemStrategy {
    discardOldItems {
      daysToKeep(14)
      numToKeep(30)
    }
  }
  triggers {
    periodicFolderTrigger { interval('5m') }
  }
}

pipelineJob('nava/deploy') {
  displayName('Deploy')
  description('Despliega un SHA de main en /srv/nava: imagen, arranque, salud por edge y https://nava.wtf/healthz.')
  parameters {
    stringParam('SHA', '', 'SHA de main a desplegar (vacío = último commit de main).')
    booleanParam('AUTO', false, 'Lo marca el CI. Si main ya avanzó, se omite este despliegue.')
  }
  logRotator { numToKeep(60) }
  definition {
    cpsScm {
      scm {
        git {
          remote {
            url("${navaUrl}.git")
            credentials('github-token')
          }
          branch('*/main')
        }
      }
      scriptPath('deploy/jenkins/deploy.Jenkinsfile')
      lightweight(true)
    }
  }
}

// ---------------------------------------------------------------------------------------
// Nava Nexos, antes Odin (bcaceres19/nava-nexos, /srv/odin). Mismo patrón que agenda/: el
// Jenkinsfile y deploy/jenkins/deploy.Jenkinsfile viven en su propio repositorio.

def odinUrl = 'https://github.com/bcaceres19/nava-nexos'

folder('odin') {
  displayName('Odin')
  description("Repositorio ${odinUrl}")
}

multibranchPipelineJob('odin/ci') {
  displayName('CI')
  description('Ruff, mypy, pytest unitario, PostgreSQL 17 + pgvector con rol runtime, shellcheck, compose e imagen. Jenkinsfile en la raíz del repo.')
  branchSources {
    branchSource {
      source {
        github {
          id('odin-github')
          repoOwner('bcaceres19')
          repository('nava-nexos')
          repositoryUrl("${odinUrl}.git")
          configuredByUrl(false)
          credentialsId('github-token')
          traits {
            gitHubBranchDiscovery { strategyId(1) }
            gitHubPullRequestDiscovery { strategyId(1) }
            headWildcardFilter {
              includes('main PR-*')
              excludes('')
            }
          }
        }
      }
    }
  }
  factory {
    workflowBranchProjectFactory { scriptPath('Jenkinsfile') }
  }
  orphanedItemStrategy {
    discardOldItems {
      daysToKeep(14)
      numToKeep(30)
    }
  }
  triggers {
    periodicFolderTrigger { interval('5m') }
  }
}

pipelineJob('odin/deploy') {
  displayName('Deploy')
  description('Despliega un SHA de main en /srv/odin: imagen, base, migraciones, arranque con healthcheck y comprobación del contenedor app.')
  parameters {
    stringParam('SHA', '', 'SHA de main a desplegar (vacío = último commit de main).')
    booleanParam('AUTO', false, 'Lo marca el CI. Si main ya avanzó, se omite este despliegue.')
  }
  logRotator { numToKeep(60) }
  definition {
    cpsScm {
      scm {
        git {
          remote {
            url("${odinUrl}.git")
            credentials('github-token')
          }
          branch('*/main')
        }
      }
      scriptPath('deploy/jenkins/deploy.Jenkinsfile')
      lightweight(true)
    }
  }
}

folder('vps') {
  displayName('VPS')
  description('Tareas de la máquina compartidas por todos los proyectos.')
}

pipelineJob('vps/mantenimiento') {
  displayName('Mantenimiento de Docker')
  description('Limpia contenedores de CI huérfanos y la caché de construcción vieja.')
  logRotator { numToKeep(20) }
  properties {
    pipelineTriggers {
      triggers {
        cron { spec('H 4 * * *') }
      }
    }
  }
  definition {
    cpsScm {
      scm {
        git {
          remote {
            url("${repoUrl}.git")
            credentials('github-token')
          }
          branch('*/main')
        }
      }
      scriptPath('deploy/jenkins/pipelines/maintenance.Jenkinsfile')
      lightweight(true)
    }
  }
}
