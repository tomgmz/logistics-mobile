/**
 * Expo config plugin: tells Android which website the app's passkeys belong to.
 *
 * Android Credential Manager only lets the app create/use passkeys for an RP ID
 * when the app declares that site's Digital Asset Links file. That declaration
 * is an `asset_statements` string resource plus a matching <meta-data> entry in
 * the manifest. android/ is gitignored and `expo prebuild --clean` regenerates
 * it, so hand edits to strings.xml were lost on every clean prebuild — this
 * plugin writes both on each prebuild instead.
 *
 * The domain must equal the backend's WEBAUTHN_RP_ID, and
 * https://<domain>/.well-known/assetlinks.json must be served without a redirect.
 */
const { AndroidConfig, withAndroidManifest, withStringsXml } = require('@expo/config-plugins')

const RESOURCE_NAME = 'asset_statements'

function assetStatements(domain) {
  return JSON.stringify([{ include: `https://${domain}/.well-known/assetlinks.json` }])
}

module.exports = function withPasskeyAssetLinks(config, { domain }) {
  if (!domain) throw new Error('with-passkey-asset-links: `domain` is required')

  config = withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: RESOURCE_NAME, translatable: 'false' }, _: assetStatements(domain) }],
      cfg.modResults,
    )
    return cfg
  })

  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults)
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      app,
      RESOURCE_NAME,
      `@string/${RESOURCE_NAME}`,
      'resource',
    )
    return cfg
  })
}
