const fs = require('fs')
const jsonData = fs.readFileSync('./firebase-key.json')

const base64String = Buffer.from(jsonData, 'utf-8').toString('base64')
