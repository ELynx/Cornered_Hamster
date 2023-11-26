module.exports = function (grunt) {
  const envVars = process.env

  const options =
  {
    email: envVars.PUSH_EMAIL,
    token: envVars.PUSH_TOKEN,
    branch: envVars.PUSH_BRANCH
  }

  if (envVars.PUSH_PTR === 'true') {
    options.ptr = true
  }

  const dist =
  {
    src: [envVars.PUSH_WHAT]
  }

  grunt.loadNpmTasks('grunt-screeps')

  grunt.initConfig(
    {
      screeps:
        {
          options,
          dist
        }
    }
  )
}
