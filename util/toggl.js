//helper for toggl

let toggl = {};
const fetch = require('node-fetch');
require('dotenv').config()

const config = require('../config/config.json');


toggl.request = async function request(requestType, options) {
    // requestType == workspaces
    //options == {workspaceId: 123}

    let requestOptions = {
        method: 'GET',
        headers: {
            "Authorization": process.env.AUTHORIZATION
        },
    };
    let url = this.urlBuilder(requestType, options)

    // const params = {
    //     user_agent: 'timothysl_goh@certisgroup.com',
    // }
    //
    // const queryParams = new URLSearchParams(params).toString();
    // url.search = queryParams;

    const response = await fetch(url, requestOptions)
    let data = await response.json();
    return data
}

toggl.urlBuilder = function urlBuilder(requestType, options) {
    let baseApiUrl = config.apiUrl;

    let url
    switch (requestType) {
        case 'workspaces': {
            let workspaceId = options.workspaceId
            let get = options.get //projects etc
            url = baseApiUrl + requestType + '/' + workspaceId + '/projects'
        }
            break
    }
    return url
}

toggl.getProjects = async function getProjects() {
    let projects = {}
    for ([wName, wid] of Object.entries(config.workspaces)) {
        let requestedProjects = await this.request('workspaces', {workspaceId: wid});
        requestedProjects.forEach((p) => {
            projects[p.id] = p
        })
    }
    return projects;
}


module.exports = toggl
