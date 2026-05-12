const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })
require('dotenv').config({ path: path.resolve(__dirname, '.env') })

const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');
 
const config = getDefaultConfig(__dirname)
 
module.exports = withNativeWind(config, { input: './global.css' })