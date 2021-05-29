const dotenv = require('dotenv');

// dotenv.config without any options looks for a env in your current working directory
// since this is a command line application, the current working directory could be anything
// eg console.log('current working directory',process.cwd())
// instead, use __dirname (the directory of this js file) to point to the .env file in this project

dotenv.config({path: __dirname + '/../.env'});

module.exports = {
    authorization: process.env.AUTHORIZATION
};