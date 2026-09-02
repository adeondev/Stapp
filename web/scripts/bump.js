#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rawArg = process.argv[2]

if (!rawArg || rawArg === '--help' || rawArg === '-h') {
  console.log(`
Uso:
  pnpm bump <nova-versao>

Exemplos:
  pnpm bump 0.1.0-beta.1
  pnpm bump 0.1.0-beta.2
  pnpm bump 0.1.0
  pnpm bump 0.2.0
`)
  process.exit(0)
}

// Remove prefixo 'v' se fornecido por engano
const targetVersion = rawArg.startsWith('v') ? rawArg.slice(1) : rawArg

// Validacao SemVer basica
const semverRegex = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
if (!semverRegex.test(targetVersion)) {
  console.error(`❌ Erro: "${rawArg}" não é uma versão SemVer válida (ex: 0.1.0, 0.1.0-beta.1, 1.0.0).`)
  process.exit(1)
}

const rootDir = path.resolve(__dirname, '../..')
const webPackageJsonPath = path.resolve(rootDir, 'web/package.json')
const tauriCargoPath = path.resolve(rootDir, 'web/src-tauri/Cargo.toml')
const serverCargoPath = path.resolve(rootDir, 'server/Cargo.toml')

function updatePackageJson(filePath, version) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const pkg = JSON.parse(content)
  const oldVersion = pkg.version
  pkg.version = version
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
  return oldVersion
}

function updateCargoToml(filePath, version) {
  let content = fs.readFileSync(filePath, 'utf-8')
  // Substitui apenas o 'version = "..."' que fica sob [package]
  const updated = content.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`)
  fs.writeFileSync(filePath, updated, 'utf-8')
}

console.log(`\n🚀 Atualizando versão do Stapp para v${targetVersion}...\n`)

// 1. web/package.json (e o tauri.conf.json herda dele automaticamente)
const oldVer = updatePackageJson(webPackageJsonPath, targetVersion)
console.log(`  ✓ web/package.json (${oldVer} -> ${targetVersion})`)
console.log(`  ✓ web/src-tauri/tauri.conf.json (herda automaticamente de package.json)`)

// 2. web/src-tauri/Cargo.toml
updateCargoToml(tauriCargoPath, targetVersion)
console.log(`  ✓ web/src-tauri/Cargo.toml -> ${targetVersion}`)

// 3. server/Cargo.toml
updateCargoToml(serverCargoPath, targetVersion)
console.log(`  ✓ server/Cargo.toml -> ${targetVersion}`)

console.log(`
✨ Versão atualizada com sucesso em todos os manifestos!

Próximos passos para lançar a release:
  git add .
  git commit -m "chore(release): bump version to ${targetVersion}"
  git tag v${targetVersion}
  git push origin main
  git push origin v${targetVersion}
`)
