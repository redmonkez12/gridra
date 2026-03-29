import { execFileSync } from 'node:child_process'

const limits = {
  '@gridra/core': {
    tarball: 30 * 1024,
    unpacked: 130 * 1024,
  },
  '@gridra/react': {
    tarball: 12 * 1024,
    unpacked: 50 * 1024,
  },
}

const formatSize = (bytes) => `${(bytes / 1024).toFixed(1)} kB`

for (const [workspace, threshold] of Object.entries(limits)) {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--dry-run', '--workspace', workspace],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )

  const [packResult] = JSON.parse(output)

  if (!packResult) {
    throw new Error(`npm pack did not return metadata for ${workspace}`)
  }

  const messages = []

  if (packResult.size > threshold.tarball) {
    messages.push(
      `tarball ${formatSize(packResult.size)} exceeds ${formatSize(threshold.tarball)}`,
    )
  }

  if (packResult.unpackedSize > threshold.unpacked) {
    messages.push(
      `unpacked size ${formatSize(packResult.unpackedSize)} exceeds ${formatSize(threshold.unpacked)}`,
    )
  }

  if (messages.length > 0) {
    throw new Error(`${workspace}: ${messages.join(', ')}`)
  }

  console.log(
    `${workspace}: tarball ${formatSize(packResult.size)}, unpacked ${formatSize(packResult.unpackedSize)}`,
  )
}
