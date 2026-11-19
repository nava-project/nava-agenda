import '@/styles/fonts.css'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/motion.css'
import '@/styles/statusMarks.css'

import { createApplication } from '@/app/bootstrap/createApp'
import { releaseBootLoader } from '@/app/bootstrap/bootLoader'
import { router } from '@/app/router'

createApplication().mount('#app')
void releaseBootLoader(router)
