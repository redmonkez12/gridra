import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()

const packageChecks = {
  '@gridra/core': {
    dir: 'packages/core',
    allowedExports: ['.'],
    allowedDependencies: [],
    allowedPeerDependencies: [],
    repositoryUrl: 'https://github.com/redmonkez12/gridra.git',
    repositoryDirectory: 'packages/core',
  },
  '@gridra/react': {
    dir: 'packages/react',
    allowedExports: ['.'],
    allowedDependencies: ['@gridra/core'],
    allowedPeerDependencies: ['react'],
    repositoryUrl: 'https://github.com/redmonkez12/gridra.git',
    repositoryDirectory: 'packages/react',
  },
}

const blockedFilePatterns = [
  /(^|\/)__tests__\//,
  /(^|\/)(test|tests)\//,
  /(^|\/)(demo|demos|example|examples)\//,
  /\.test\.[^.]+$/i,
  /\.spec\.[^.]+$/i,
  /\.map$/i,
]

for (const [workspace, rules] of Object.entries(packageChecks)) {
  const packageJsonPath = path.join(rootDir, rules.dir, 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

  const exportKeys = Object.keys(packageJson.exports ?? {}).sort()
  const dependencyKeys = Object.keys(packageJson.dependencies ?? {}).sort()
  const peerDependencyKeys = Object.keys(
    packageJson.peerDependencies ?? {},
  ).sort()
  const packageErrors = []
  const repositoryUrl = packageJson.repository?.url
  const repositoryDirectory = packageJson.repository?.directory

  if (
    JSON.stringify(exportKeys) !==
    JSON.stringify([...rules.allowedExports].sort())
  ) {
    packageErrors.push(
      `exports must stay limited to ${rules.allowedExports.join(', ')}, found ${exportKeys.join(', ') || '(none)'}`,
    )
  }

  if (
    JSON.stringify(dependencyKeys) !==
    JSON.stringify([...rules.allowedDependencies].sort())
  ) {
    packageErrors.push(
      `runtime dependencies must stay limited to ${rules.allowedDependencies.join(', ') || '(none)'}, found ${dependencyKeys.join(', ') || '(none)'}`,
    )
  }

  if (
    JSON.stringify(peerDependencyKeys) !==
    JSON.stringify([...rules.allowedPeerDependencies].sort())
  ) {
    packageErrors.push(
      `peer dependencies must stay limited to ${rules.allowedPeerDependencies.join(', ') || '(none)'}, found ${peerDependencyKeys.join(', ') || '(none)'}`,
    )
  }

  if (repositoryUrl !== rules.repositoryUrl) {
    packageErrors.push(
      `repository.url must be ${rules.repositoryUrl}, found ${repositoryUrl ?? '(none)'}`,
    )
  }

  if (repositoryDirectory !== rules.repositoryDirectory) {
    packageErrors.push(
      `repository.directory must be ${rules.repositoryDirectory}, found ${repositoryDirectory ?? '(none)'}`,
    )
  }

  const output = execFileSync(
    'npm',
    ['pack', '--json', '--dry-run', '--workspace', workspace],
    {
      cwd: rootDir,
      encoding: 'utf8',
    },
  )

  const [packResult] = JSON.parse(output)

  if (!packResult) {
    packageErrors.push('npm pack did not return metadata')
  } else {
    const packedPaths = new Set(
      (packResult.files ?? []).map((file) => file.path),
    )

    if (!packedPaths.has('LICENSE')) {
      packageErrors.push('packed files must include LICENSE')
    }

    for (const file of packResult.files ?? []) {
      if (/\.(?:ts|tsx)$/i.test(file.path) && !/\.d\.ts$/i.test(file.path)) {
        packageErrors.push(
          `packed file ${file.path} must not include source files`,
        )
        continue
      }

      const matchedPattern = blockedFilePatterns.find((pattern) =>
        pattern.test(file.path),
      )

      if (matchedPattern) {
        packageErrors.push(
          `packed file ${file.path} matches blocked pattern ${matchedPattern}`,
        )
      }
    }
  }

  if (packageErrors.length > 0) {
    throw new Error(`${workspace}:\n- ${packageErrors.join('\n- ')}`)
  }

  console.log(`${workspace}: publish surface verified`)
}
