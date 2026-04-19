const path = require('node:path')
// Ensure EXPO_PUBLIC_* from parent `mobile/.env` is visible to Metro (same as app.config.ts).
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');
 
const config = getDefaultConfig(__dirname)
 
module.exports = withNativeWind(config, { input: './global.css' })