#!/usr/bin/env node
// the shebang is needed because this is a command line executable
// package.json > bin maps a command to this file
// the os needs the shebang to understand what to do with this file

// require('dotenv').config()
const {authorization} = require('./config/config');

const fetch = require('node-fetch');
const fs = require('fs');
const chalk = require('chalk');
const Table = require('cli-table3');
const time = require('./util/time');
const moment = require('moment');
const highlight = require('cli-highlight').highlight;
const _ = require('lodash');

const argv = require('minimist')(process.argv.slice(2));
const toggl = require('./util/toggl')
// const Conf = require('conf')
// let config = new Conf();

const logger = require('./util/logger')
const config = require('./config/config.json');

async function run() {
    // if (Object.keys(argv).length == 1 && argv._ && argv._.length == 0) {
    if (argv.h) {
        showHelp();
        return;
    }

    const headers = {
        "Authorization": authorization
    }
    let requestOptions = {
        method: 'GET',
        headers: headers,
    };
    let reportType = 'details';

    if (argv.t) {
        switch (argv.t) {
            case 'd': //details
                reportType = 'details';
                break;
            case 'w': //weekly
                reportType = 'weekly';
                break;
            case 's': //summary
                reportType = 'summary';
        }
    }

    const url = new URL(`${config.reportUrl}${reportType}`)
    const params = {
        user_agent: 'timothysl_goh@certisgroup.com',
        workspace_id: '1335456' //TODO pass in workspace id
    }

    let startDate;
    let endDate = moment();


    if (argv.r) {
        let {start, end} = time.convertRange(argv.r)
        startDate = start
        endDate = end
    } else {
        if (argv.s) {
            startDate = time.convertDate(argv.s)
        } else {
            startDate = moment().startOf('isoWeek'); //default startDate to monday of current week
        }
        if (argv.e) {
            endDate = time.convertDate(argv.e)
        }
    }
    if (reportType == 'weekly') {
        // startDate = moment().startOf('isoWeek');
        endDate = startDate.clone().add(6, 'days');
    }
    params.since = startDate.format('YYYY-MM-DD')
    params.until = endDate.format('YYYY-MM-DD');


    let workspaceId = '1335456' //default to study

    if (argv.w) {
        switch (argv.w) {
            case 'c': //certis
                workspaceId = 3861113
                break;
            case 'm': //me
                workspaceId = 4858804
                break;
            case 's': //study
                workspaceId = 1335456
                break;
            default:
                workspaceId = 1335456
        }
    }
    params.workspace_id = workspaceId;


    let page = 1
    params.page = page;
    const queryParams = new URLSearchParams(params).toString();
    url.search = queryParams;


    const response = await fetch(url, requestOptions)
    let data = await response.json();
    if (data.error) {
        console.log('toggl api error:', data.error)
        return;
    }

    let total_count = data.total_count;
    let per_page = data.per_page;

    if (total_count > per_page) {
        let innerLength = data.data.length;
        while (innerLength > 0) {
            page++;
            params.page = page;
            const queryParams = new URLSearchParams(params).toString();
            url.search = queryParams;
            const response = await fetch(url, requestOptions)
            const newdata = await response.json();
            innerLength = newdata.data.length;
            data.data = data.data.concat(newdata.data);

        }
    }

    if (argv.j) {
        let dataString = JSON.stringify(data, null, 4);
        console.log(highlight(dataString));
    } else {
        if (data.data.length == 0) {
            let dataString = JSON.stringify(data, null, 4);
            console.log(highlight(dataString));
        } else {
            if (reportType == 'details') {
                if (argv.ww) {
                    data.report = sum(data, startDate, endDate);
                    data.report = group(data.report, startDate);
                } else {
                    data.clientTotals = getClientTotals(data);
                }
            }
            let output = await format(data, reportType, startDate, endDate);
            console.log(output);
        }
    }
}

function group(report, startDate) {
    // does startDate need to be a global variable?
    // add weekly totals to columns
    // add weekly percentages to columns

    // let dataString = JSON.stringify(data, null, 4);
    let grandWeekTotals = report.weekTotals
    let grandTotal = report.total
    let clientNames = Object.keys(report.clients)
    for (let i = 0; i < clientNames.length; i++) {
        let clientName = clientNames[i];
        let client = report.clients[clientName]
        let projectNames = Object.keys(client.projects)

        for (let j = 0; j < projectNames.length; j++) {
            let projectName = projectNames[j];
            let project = client.projects[projectName]
            let tagNames = Object.keys(project.tags)
            for (let k = 0; k < tagNames.length; k++) {
                let tagName = tagNames[k];
                let tag = project.tags[tagName]

                let {dgt, isDgtGroup} = getDayGroupTotalsAndPercent(startDate, tag.dayTotals, grandWeekTotals, grandTotal);
                tag.dayGroupTotals = dgt;
                tag.isDayGroupTotalsGroup = isDgtGroup;
            }
            let {dgt, isDgtGroup} = getDayGroupTotalsAndPercent(startDate, project.dayTotals, grandWeekTotals, grandTotal);
            project.dayGroupTotals = dgt;
            project.isDayGroupTotalsGroup = isDgtGroup;
        }
        let {dgt, isDgtGroup} = getDayGroupTotalsAndPercent(startDate, client.dayTotals, grandWeekTotals, grandTotal);
        client.dayGroupTotals = dgt;
        client.isDayGroupTotalsGroup = isDgtGroup;
    }
    let {dgt, isDgtGroup} = getDayGroupTotalsAndPercent(startDate, report.dayTotals, grandTotal);
    report.dayGroupTotals = dgt;
    report.isDayGroupTotalsGroup = isDgtGroup;
    logger.verboseLog('report', report);
    return report
}

//add a column to sum the results after every column which is a sunday
function getDayGroupTotalsAndPercent(startDate, dayTotals, grandWeekTotals = null, grandTotal = null) {
//isolation - column headers depend on this so if you change this, column headers need to add columns as well zzzz
//start date - start date of report
//grandTotal - the grand grand total - sum of all the time in the report, not just the row total

    let dow = startDate.day(); //monday = 1 and so on
    let dayGroupTotals = []
    let isDayGroupTotalsGroup = [] //true if groupTotal, false if dayTotal

    let groupTotal = 0; //set up a runningTotal that resets after every sunday;

    let week = 0; //calendar wee
    for (let i = 0; i < dayTotals.length - 1; i++) {
        let dayTotal = dayTotals[i];
        groupTotal += dayTotal;

        dayGroupTotals.push(dayTotal)
        isDayGroupTotalsGroup.push(false);
        if (dow % 7 == 0 || i == dayTotals.length - 2) {
            isDayGroupTotalsGroup.push(true);
            isDayGroupTotalsGroup.push(null); //todo: code smell null means percentage column ZZZ

            let percent = null;
            let weekTotal
            if (grandWeekTotals) {
                weekTotal = grandWeekTotals[week]
                percent = weekTotal ? Math.round((groupTotal / weekTotal * 100)) : null
            }
            dayGroupTotals.push(groupTotal)
            dayGroupTotals.push(percent) //add percent column
            groupTotal = 0;
            week++
        }
        dow++
    }
    let weekGrandTotal = dayTotals[dayTotals.length - 1]
    dayGroupTotals.push(weekGrandTotal)
    let grandPercent = grandTotal ? Math.round((weekGrandTotal / grandTotal * 100)) : null
    dayGroupTotals.push(grandPercent)

    isDayGroupTotalsGroup.push(true); //todo code smell this total column is different from the other total columns zzz
    return {
        dgt: dayGroupTotals,
        isDgtGroup: isDayGroupTotalsGroup
    }
}

function sum(data, startDate, endDate) {
    let sortedData = (_.sortBy(data.data, ['client', 'project', 'tags[0]']))
    let reportFormat = {
        "clients": {
            "argus": {
                "projects": {
                    "project1":
                        {
                            id: 123,
                            hex_color: 456,
                            "tags": {
                                "tag1": {
                                    "dayTotals": [455, 2, 36, 99999],
                                    "weekTotals": [455, 2, 36, 99999],
                                    "monthTotals": [455, 2, 36, 99999], //kiv may not be used
                                    total: 123
                                }, //tag total in last column
                                "tag2": {
                                    "dayTotals": [455, 2, 36, 99999],
                                    "weekTotals": [455, 2, 36, 99999],
                                    "monthTotals": [455, 2, 36, 99999],
                                    total: 123
                                }, //tag total in last column
                            },
                            "dayTotals": [455, 2, 36, 99999],
                            "weekTotals": [455, 2, 36, 99999],
                            "monthTotals": [455, 2, 36, 99999],
                            "total": 123,
                        },
                    "project2":
                        {
                            id: 123,
                            hex_color: 456,
                            "tags": {
                                "tag1": {
                                    "totals": [455, 2, 36, 99999]
                                }, //tag total in last column
                                "tag2": {
                                    "totals": [455, 2, 36, 99999]
                                }, //tag total in last column
                            },
                            "dayTotals": [455, 2, 36, 99999],
                            "weekTotals": [455, 2, 36, 99999],
                            "monthTotals": [455, 2, 36, 99999],
                            "total": 123,
                        },
                },
                "dayTotals": [455, 2, 36, 99999],
                "weekTotals": [455, 2, 36, 99999],
                "monthTotals": [455, 2, 36, 99999],
                "total": 123,
            },
            "calltree": "{...}",
        },
        "dayTotals": [455, 2, 36, 99999],
        "weekTotals": [455, 2, 36, 99999],
        "monthTotals": [455, 2, 36, 99999],
        "total": 123,
    };

//get date range
    let start = moment(startDate)
    let end = moment(endDate)
    let daysInRange = end.diff(start, 'days') + 1
    let report
    for (i = 0; i < sortedData.length; i++) {
        let entry = sortedData[i]
        let entryStartDate = entry.start
        let client = entry.client ?? null;
        let project = entry.project ?? null;
        let pid = entry.pid;
        let hexColor = entry.project_hex_color;
        let tag = entry.tags[0] ?? null;
        let dur = entry.dur;

        //0 based column number
        //need to get col for dayTotal and weekTotal
        let col = getColumnNumberOfTimeEntry(entryStartDate, startDate, daysInRange)

        //add duration to report
        report = addTimeEntryToReport(report, daysInRange, client, project, pid, hexColor, tag, dur, col, startDate);
        //add duration to projectTotal
        //add duration to clientTotal
    }

    return report;
}


function addTimeEntryToReport(report, daysInRange, client, project, pid, hexColor, tag, dur, col, startDate) {
    //check if client exists
    //check if project exists
    //check if tag exists
    //check if weekTotalsExist
    //check

    let weeksInRange = Math.ceil(daysInRange / 7); //round up if number if days is eg 10 days
    let monthsInRange = Math.ceil(weeksInRange / 4); //assume 1 month = 4 weeks
    report = initReportTotals(report, daysInRange, weeksInRange, monthsInRange, client, project, pid, hexColor, tag);

    //add to tag
    let dayCol = col
    let startDayOfWeek = moment(startDate).day();
    //eg if first day is saturday, startDayOfWeek is 6
    // if col is 0 for saturday, then (col + startDayOfWeek - 1)/7 = 0th element of weekTotal array

    //first saturday and sunday belong to the first weektotal
    //the following monday ... sunday belong to the second weektotal

    let weekCol = Math.floor((col + startDayOfWeek - 1) / 7)
    let monthCol = Math.floor(col / 7 / 4) //todo: not useful as well
    addTimeEntry(report.clients[client].projects[project].tags[tag], dayCol, weekCol, monthCol, dur);
    addTimeEntry(report.clients[client].projects[project], dayCol, weekCol, monthCol, dur);
    addTimeEntry(report.clients[client], dayCol, weekCol, monthCol, dur);
    addTimeEntry(report, dayCol, weekCol, monthCol, dur);
    return report;
}

function addTimeEntry(group, dayCol, weekCol, monthCol, dur) {
    // group has the structure
    // {
    //     dayTotals: []
    //     weekTotals: []
    //     monthTotals: []
    //     total
    // }
    group.dayTotals[dayCol] += dur;
    let dayTotals = group.dayTotals
    group.dayTotals[dayTotals.length - 1] += dur;

    group.weekTotals[weekCol] += dur;
    let weekTotals = group.weekTotals
    group.weekTotals[weekTotals.length - 1] += dur;

    // group.monthTotals[monthCol] += dur;
    // let monthTotals = group.monthTotals
    // group.monthTotals[monthTotals.length - 1] += dur;

    group.total += dur;
}

function initReportTotals(report, daysInRange, weeksInRange, monthsInRange, client, project, pid, hexColor, tag) {
    if (!report) {
        report = {
            clients: {},
            dayTotals: Array(daysInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            weekTotals: Array(weeksInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            monthTotals: Array(monthsInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            total: 0,
        };
    }

    //if client not found, initialize the client object
    if (!report.clients[client]) {
        report.clients[client] = {
            projects: {},
            dayTotals: Array(daysInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            weekTotals: Array(weeksInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            monthTotals: Array(monthsInRange + 1).fill(0),//add 1 to add the last column which will store the rowTotal
            total: 0,
        };
    }
    //if client project not found, initialize it
    if (!report.clients[client].projects[project]) {
        report.clients[client].projects[project] = {
            id: pid,
            hexColor: hexColor,
            tags: {},
            dayTotals: Array(daysInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            weekTotals: Array(weeksInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            monthTotals: Array(monthsInRange + 1).fill(0),//add 1 to add the last column which will store the rowTotal
            total: 0,
        };
    }
    //if client project tag not found, initialize it
    if (!report.clients[client].projects[project].tags[tag]) {
        report.clients[client].projects[project].tags[tag] = {
            dayTotals: Array(daysInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            weekTotals: Array(weeksInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            monthTotals: Array(monthsInRange + 1).fill(0), //add 1 to add the last column which will store the rowTotal
            total: 0,
        }
    }
    return report
}

function getColumnNumberOfTimeEntry(entryStartDate, startDate, daysInRange) {
    let entryStart = moment(entryStartDate).startOf('day'); //remove time portion so that momentjs doesn't round the diff
    let col = entryStart.diff(startDate, 'days'); //0 based if entryStart and startDate are the same, return 0
    return col;
}

function getClientTotals(data) {
    let sortedData = (_.sortBy(data.data, ['client']))

    let clientTotals = {};
    let clientTotal = 0
    let isFirstClientRow;
    for (i = 0; i < sortedData.length; i++) {
        let row = sortedData[i];
        let client = row.client
        let dur = row.dur
        let previousRow
        if (i < sortedData.length - 1) {
            nextRow = sortedData[i + 1]
        }

        if (i == 0) {
            isFirstClientRow = true;
            clientTotals[client] = dur;
        } else {
            let previousClient = sortedData[i - 1].client ?? 'Without client'
            if (client == previousClient) {
                isFirstClientRow = false;
                clientTotals[client] += dur;
            } else {
                isFirstClientRow = true;
                clientTotals[client] = dur;
            }
        }

    }

    return clientTotals
}

async function format(data, reportType, startDate, endDate) {
    switch (reportType) {
        case 'details': {
            let table
            if (argv.dd) { //chronological order
                //assume data sorted by date descending
                table = new Table({
                    head: ['day', 'start', 'end', 'client', 'project', 'h', 'm', 'description', 'tags'],
                    colAligns: ['', 'right', '', '', '', 'right', 'right'],
                    style: {head: ['green'], 'padding-left': 0, 'padding-right': 0, compact: true}
                })
            } else if (argv.ww) { //weekly order
            } else {
                table = new Table({
                    head: ['client', 'project', 'tag', 'h', 'm', 'CT%', 'GT%'],
                    colAligns: ['', '', '', 'right', 'right', 'right', 'right'],
                    style: {head: ['green'], 'padding-left': 0, 'padding-right': 0, compact: true}
                })
                data.data = (_.sortBy(data.data, ['client', 'project', 'tags[0]']))
            }

            let table1 = new Table({
                // head: ['project', 'task', 'h', 'm'],
                chars: {
                    'top': '', 'top-mid': '', 'top-left': '', 'top-right': ''
                    , 'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': ''
                    , 'left': '', 'left-mid': '', 'mid': '', 'mid-mid': ''
                    , 'right': '', 'right-mid': '', 'middle': ' '
                },
                style: {'padding-left': 0, 'padding-right': 0}
            })
            let startWeek = startDate.isoWeek()
            let endWeek = endDate.isoWeek()
            
            table1.push(['report type:', reportType]);
            table1.push(['week:', `${startWeek}${startWeek === endWeek ? "" : endWeek}`]);
            table1.push(['date:', `${startDate.format('DD MMM')} - ${endDate.format('DD MMM')}`]);
            table1.push([chalk.grey('total count:'), chalk.grey(data.total_count)]);
            table1.push([chalk.grey('per page:'), chalk.grey(data.per_page)]);
            let hourMin = time.toHourMin(data.total_grand);
            table1.push([chalk.grey('total time:'), chalk.bold.red(hourMin.hour + 'h ' + hourMin.min + 'm')]);

            if (argv.ww) {
                //detailed long format
                table = printWeeklyLongReport(data.report, startDate, endDate)
            } else {//--dd or normal


                let isFirstDayRow = true;
                let isLastDayRow = false;
                let isFirstHourRow = true; // for --dd report, do not print the hour for the next row if the hour is the same as the previous row
                let isFirstClientRow = true;
                let isLastClientRow = false;
                let isFirstProjectRow = true;
                let isLastProjectRow = false;
                let isFirstTagRow = true;
                let isLastTagRow = false;
                let dayTotal, clientTotal, projectTotal, tagTotal = 0;
                let grandTotal = data.total_grand;
                for (i = 0; i < data.data.length; i++) {
                    let row = data.data[i];
                    let nextRow;
                    if (i < data.data.length - 1) {
                        nextRow = data.data[i + 1];
                    }
                    let client = row.client ?? 'Without client';
                    let project = row.project ?? 'Without project';
                    let tag = row.tags[0] ?? null;
                    let description = row.description;
                    let tags = row.tags;
                    let dur = row.dur;
                    let {hour, min} = time.toHourMin(row.dur);
                    let date = moment(row.start, "YYYYMMDD");

                    if (i == 0) {
                        isFirstDayRow = true; //the first row of a time entry with a different day
                        isFirstClientRow = true;
                        isFirstProjectRow = true;
                        isFirstTagRow = true;

                        dayTotal = dur;
                        clientTotal = dur;
                        projectTotal = dur;
                        tagTotal = dur;
                    } else {
                        //do not repeat projectNames if there are many rows with the same project name
                        let previousRow = data.data[i - 1];
                        let previousRowDate = moment(previousRow.start, "YYYYMMDD");

                        // let currentRowStartHour  = moment(row.start,"HH").valueOf();
                        let currentRowStartHour = moment(row.start).format("HH")
                        let previousRowStartHour = moment(previousRow.start).format("HH")
                        if (currentRowStartHour == previousRowStartHour) {
                            isFirstHourRow = false;
                        } else {
                            isFirstHourRow = true;
                        }

                        if (date.valueOf() == previousRowDate.valueOf()) {
                            isFirstDayRow = false;
                            dayTotal += dur;
                        } else {
                            isFirstDayRow = true;
                            dayTotal = dur;
                        }

                        let previousClient = previousRow.client ?? 'Without client'
                        if (client == previousClient) {
                            isFirstClientRow = false;
                            clientTotal += dur;
                            // let {hour,min} = time.toHourMin(dur)
                        } else {
                            isFirstClientRow = true;
                            clientTotal = dur;
                            // let {hour,min} = time.toHourMin(dur)
                        }

                        let previousProject = previousRow.project ?? 'Without project'
                        if (project == previousProject) {
                            isFirstProjectRow = false;
                            projectTotal += dur;
                        } else {
                            isFirstProjectRow = true;
                            projectTotal = dur;
                        }

                        let previousTag = previousRow.tags[0] ?? null;

                        if (tag == previousTag && project == previousProject) {
                            isFirstTagRow = false;
                            tagTotal += dur;
                            let {hour, min} = time.toHourMin(tagTotal)
                        } else {
                            isFirstTagRow = true;
                            tagTotal = dur;
                            let {hour, min} = time.toHourMin(tagTotal)
                        }
                    }

                    let nextRowDay, nextRowClient, nextRowProject, nextRowTag;
                    if (i < data.data.length - 1) {
                        nextRowDay = moment(nextRow.start, "YYYYMMDD");
                        nextRowClient = nextRow.client ?? 'Without client'
                        nextRowProject = nextRow.project ?? 'Without project'
                        nextRowTag = nextRow.tags[0] ?? null;

                        isLastDayRow = nextRowDay.valueOf() != date.valueOf() ? true : false;
                        isLastClientRow = nextRowClient != client ? true : false;
                        isLastProjectRow = nextRowProject != project ? true : false;

                        //if next entry is not from the same project
                        //or if next entry is not from the same client
                        //or if next entry has a different tag,
                        //or we are at the last row of data,
                        // then isLastTagRow is true!
                        isLastTagRow = (nextRowTag != tag || isLastClientRow || isLastProjectRow) ? true : false;
                    } else { //if i is == the last row
                        isLastDayRow = true;
                        isLastClientRow = true;
                        isLastProjectRow = true;
                        isLastTagRow = true;
                    }

                    if (argv.dd) {
                        let end = row.end ? moment(row.end).format('HHmm') : '';
                        if (isFirstClientRow) {
                        } else {
                            client = '';
                        }
                        if (isFirstProjectRow) {
                        } else {
                            project = '';
                        }

                        if (isFirstDayRow) {
                            date = moment(date).format("ddd DD MMM")
                        } else {
                            date = '';
                        }

                        let start
                        if (isFirstHourRow) {
                            start = moment(row.start).format('HHmm')
                        } else {
                            start = moment(row.start).format('mm')
                        }

                        let hex_color = row.project_hex_color;
                        project = chalk.hex(`${hex_color}`)(project);
                        description = chalk.hex(`${hex_color}`)(description);

                        let {hour, min} = time.toHourMin(row.dur);
                        if (hour == 0) {
                            hour = chalk.hex('#6d6d6d')(hour)
                        }
                        if (min < 10) {
                            min = '0' + min;
                        }
                        min = chalk.hex('#6d6d6d')(min);

                        if (isFirstDayRow) {
                            table.push([date])
                        }
                        table.push(['', start, end, client, project, hour, min, description, tags.toString()])
                        if (isLastDayRow || i == data.data.length - 1) { //or last row of report
                            let {hour, min} = time.toHourMin(dayTotal);
                            table.push(['', '', '', '', chalk.cyan('Day Total:'), chalk.bold.cyan(hour), chalk.cyan(min)])
                        }

                    } else {
                        // if not --dd
                        if (isFirstClientRow) {
                            table.push([client])
                        }
                        let hex_color = row.project_hex_color;
                        if (project == 'Without project') {
                            hex_color = '#ffffff'
                        }
                        if (isFirstProjectRow) {
                            // if (project == 'Without project') {
                            //     //without project is grey and hard to read in the terminal, do not colour it
                            // } else {
                            project = chalk.hex(`${hex_color}`)(project);
                            // }
                            table.push(['', project,])
                        }
                        if (isLastTagRow) {
                            // head: ['client', 'project', 'tag', 'start', 'end', 'h', 'm', 'description', 'tags'],
                            let {hour, min} = time.toHourMin(tagTotal);
                            if (hour == 0) {
                                hour = chalk.hex('#6d6d6d')(hour)
                            } else {
                                hour = chalk.hex(`${hex_color}`)(hour)
                            }
                            if (min < 10) {
                                min = '0' + min;
                            }
                            tag = chalk.hex(`${hex_color}`)(tag);
                            let clientTotal = data.clientTotals[client]
                            if (client == 'Without client') {
                                clientTotal = data.clientTotals['null']
                            }

                            let tagClientPercent = Math.round((tagTotal / clientTotal) * 100)
                            tagClientPercent = chalk.grey(tagClientPercent + '%')

                            let tagGrandTotalPercent = Math.round((tagTotal / grandTotal) * 100)
                            if (tagGrandTotalPercent < 10) {
                                tagGrandTotalPercent = chalk.grey(tagGrandTotalPercent + '%')
                            } else {
                                tagGrandTotalPercent = chalk.bold.cyan(tagGrandTotalPercent + '%')
                            }

                            table.push(['', '', {
                                hAlign: 'right',
                                content: tag
                            }, hour, chalk.grey(min), tagClientPercent, tagGrandTotalPercent])
                        }
                        if (isLastClientRow) {

                            let {hour, min} = time.toHourMin(clientTotal);
                            if (hour == 0) {
                                hour = chalk.hex('#6d6d6d')(hour)
                            }
                            if (min < 10) {
                                min = '0' + min;
                            }
                            table.push(['', '', chalk.bold('Client Total:'), chalk.bold(hour), chalk.grey(min), chalk.bold(Math.round((clientTotal / grandTotal) * 100) + '%')])
                        }


                    }
                }

                let {hour, min} = time.toHourMin(data.total_grand);
                if (argv.dd) {
                    table.push(['', '', '', '', chalk.bold.cyan('Grand Total:'), chalk.bold.cyan(hour), {
                        hAlign: 'right',
                        content: chalk.bold.cyan(min)
                    }])
                } else {
                    table.push(['', '', chalk.bold.cyan('Grand Total:'), chalk.bold.cyan(hour), {
                        hAlign: 'right',
                        content: chalk.bold.cyan(min)
                    }])
                }
            }
            return table1.toString() + '\n' + table.toString();
        }
            break
        case 'weekly': {
            let headerString = `${chalk.grey('weekly report')}` + '\n';
            headerString += `${chalk.grey('date:')} ${startDate.format('ddd DDMMM')} - ${endDate.format('ddd DDMMM')}`;

            let grandTotal = data.total_grand;
            let table = new Table({
                // head: ['project', 'task', 'h', 'm'],
                colAligns: ['', '', '', '', '', '', '', '', '', 'right', 'right'],
                style: {head: ['green'], 'padding-left': 0, 'padding-right': 0, compact: true}
            })

            let weekStartDay = startDate;

            let day1 = weekStartDay.format('ddDD');
            let day2 = weekStartDay.add(1, 'day').format('ddDD');
            let day3 = weekStartDay.add(1, 'day').format('ddDD');
            let day4 = weekStartDay.add(1, 'day').format('ddDD');
            let day5 = weekStartDay.add(1, 'day').format('ddDD');
            let day6 = weekStartDay.add(1, 'day').format('ddDD');
            let day7 = weekStartDay.add(1, 'day').format('ddDD');


            let {hour, min} = time.toHourMin(grandTotal);
            if (min < 10) {
                min = '0' + min;
            }
            // table.push([chalk.dim('grand total: ') + chalk.bold(`${hour}:${min}`)]);
            table.push(['', chalk.grey('title'), chalk.grey(day1), chalk.grey(day2), chalk.grey(day3), chalk.grey(day4), chalk.grey(day5), chalk.grey(day6), chalk.grey(day7), chalk.grey('total'), chalk.grey('%')])

            let sortedData = (_.sortBy(data.data, ['title.client', 'title.project']))
            let isFirstClientRow = true;
            let isLastClientRow;
            let clientTotal = Array(8).fill(0);
            for (let i = 0; i < sortedData.length; i++) {

                let proj = sortedData[i];
                let client = proj.title.client ?? 'Without client'
                let projectName = proj.title.project ?? 'Without project'
                let hex_color = proj.title.hex_color;

                if (i == 0) {
                    isFirstClientRow = true;
                } else {
                    //do not repeat projectNames if there are many rows with the same project name
                    let previousClient = sortedData[i - 1].title.client ?? 'Without client'
                    if (client == previousClient) {
                        isFirstClientRow = false;
                    } else {
                        isFirstClientRow = true;
                        clientTotal = Array(8).fill(0);
                    }
                }

                if (i < sortedData.length - 1) {
                    let nextClient = sortedData[i + 1].title.client ?? 'Without client'
                    if (nextClient != client) {
                        isLastClientRow = true;
                    } else {
                        isLastClientRow = false;
                    }
                }

                let projTotals = proj.totals.slice(); //copy array

                for (let i = 0; i < proj.totals.length; i++) {
                    // let timeTotals = proj.totals.map((ms) => {
                    let ms = proj.totals[i]

                    if (ms) {
                        let {hour, min} = time.toHourMin(ms);
                        if (hour == 0) {
                            hour = chalk.hex('#6d6d6d')(hour)
                        }
                        if (min < 10) {
                            min = '0' + min;
                        }
                        // min = chalk.hex('#FEF9F8')(min);
                        min = chalk.hex('#6d6d6d')(min);
                        projTotals[i] = `${hour}:${min}`
                        if (isFirstClientRow) {
                            clientTotal[i] = proj.totals[i]
                        } else {
                            clientTotal[i] += proj.totals[i]
                        }

                    } else {
                        projTotals[i] = chalk.grey('-');
                    }

                    if (i == proj.totals.length - 1) {
                        let percent = Math.round(ms / grandTotal * 100)
                        percent = prettifyPercent(percent, hex_color, true)
                        projTotals.push(percent)
                    }
                }
                if (!hex_color) {
                    hex_color = '#6d6d6d'
                }
                if (isFirstClientRow) {
                    table.push([chalk.hex(`${hex_color}`)(client)])
                }
                table.push(['', {
                    hAlign: 'right',
                    content: chalk.hex(`${hex_color}`)(projectName)
                }, projTotals[0], projTotals[1], projTotals[2], projTotals[3], projTotals[4], projTotals[5], projTotals[6], projTotals[7], projTotals[8]])

                if (isLastClientRow) {
                    clientTotalOut = clientTotal.map((ms) => {
                        if (ms) {
                            let {hour, min} = time.toHourMin(ms);
                            if (hour == 0) {
                                hour = chalk.grey(hour)
                            } else {
                                hour = chalk.bold(hour)
                            }
                            if (min < 10) {
                                min = '0' + min;
                            }
                            // min = chalk.hex('#FEF9F8')(min);
                            return `${hour}:${chalk.grey(min)}`
                        } else {
                            return chalk.grey('-');
                        }
                    })
                    let clientGrandTotal = clientTotal[7]
                    let percent = Math.round(clientGrandTotal / grandTotal * 100)
                    percent = prettifyPercent(percent, '', false, true)
                    clientTotalOut.push(percent)
                    table.push(['', chalk.bold('Subtotal:'), clientTotalOut[0], clientTotalOut[1], clientTotalOut[2], clientTotalOut[3], clientTotalOut[4], clientTotalOut[5], clientTotalOut[6], clientTotalOut[7], clientTotalOut[8]])
                }
            }//for
            // )
            let timeTotals = data.week_totals.map((total) => {
                if (total) {
                    let {hour, min} = time.toHourMin(total);
                    if (hour == 0) {
                        hour = chalk.grey(hour)
                    } else {
                        hour = chalk.cyan(hour)
                    }
                    if (min < 10) {
                        min = '0' + min;
                    } else {
                    }
                    min = chalk.hex('#6d6d6d')(min)

                    return `${hour}:${min}`;
                }
                return chalk.grey('-');
            })
            table.push(['', {
                hAlign: 'right',
                content: chalk.bold.cyan('TOTAL:')
            }, timeTotals[0], timeTotals[1], timeTotals[2], timeTotals[3], timeTotals[4], timeTotals[5], timeTotals[6], timeTotals[7]])

            return headerString + '\n' + table.toString();

        }
            break
        case 'summary': {
            //lolo why am i summing this, i can just post a summary group by clients, sub group by projects ...
            let startWeek = startDate.isoWeek()
            let endWeek = endDate.isoWeek()
            let headerString1 = `Week: ${startWeek}${startWeek === endWeek ? "" : endWeek}`;
            let headerString2 = `${chalk.grey('date:')} ${startDate.format('ddd DDMMM')} - ${endDate.format('ddd DDMMM')}`;

            let head, colAligns
            if (argv.d) {
                head = ['client', 'project', 'h', 'm', '%', 'task']
                colAligns = ['', 'right', 'right', 'right', 'right']
            } else {
                head = ['client', 'project', 'h', 'm', '%']
                colAligns = ['', 'right', 'right', 'right', '']
            }

            let table = new Table({
                head: head,
                colAligns: colAligns,
                style: {head: ['green'], 'padding-left': 0, 'padding-right': 0, compact: true}
            })
            let {hour, min} = time.toHourMin(data.total_grand);
            let grandTotal = data.total_grand


            let sortedData = (_.sortBy(data.data, ['title.client', 'title.project']))

            let clientTotal = 0;//calculate a running total for each client
            let isFirstClientRow = true;
            let isLastClientRow;

            for (i = 0; i < sortedData.length; i++) {
                let proj = sortedData[i];

                let id = proj.id ?? '-'
                let client = proj.title.client ?? 'Without client'
                let projectName = proj.title.project ?? 'Without project'

                if (i == 0) {
                    isFirstClientRow = true;
                    clientTotal += proj.time
                } else {
                    //do not repeat projectNames if there are many rows with the same project name
                    let previousClient = sortedData[i - 1].title.client ?? 'Without client'
                    if (client == previousClient) {
                        isFirstClientRow = false;
                        clientTotal += proj.time
                    } else {
                        isFirstClientRow = true;
                        clientTotal = proj.time
                    }
                }

                if (i < sortedData.length - 1) {
                    let nextClient = sortedData[i + 1].title.client ?? 'Without client'
                    if (nextClient != client) {
                        isLastClientRow = true;
                    } else {
                        isLastClientRow = false;
                    }
                }


                let colour = proj.title.hex_color ?? '#858681';
                let {hour, min} = time.toHourMin(proj.time);
                if (hour == 0) {
                    hour = chalk.grey(0)
                }

                //add a "mostly" empty row if printing client for the first time
                if (isFirstClientRow) {
                    table.push([chalk.hex(colour)(client)])
                    // table.push(['', chalk.hex(colour)(projectName), chalk.hex(colour)(hour), chalk.hex(colour)(min), chalk.dim(id)])
                }
                // table.push(['', chalk.hex(colour)(projectName), chalk.hex(colour)(hour), chalk.hex(colour)(min), chalk.dim(id)])
                let percent = Math.round(proj.time / grandTotal * 100)
                percent = prettifyPercent(percent, colour, true)


                let row = ['', chalk.hex(colour)(projectName), chalk.hex(colour)(hour), chalk.hex(colour)(min)]
                // if (argv.d) {
                //     row.push('percent')
                // }
                row.push(percent)
                table.push(row)

                if (argv.d) {
                    for (let i = 0; i < proj.items.length; i++) {
                        let item = proj.items[i];
                        let nextItem;
                        if (i != proj.items.length - 1) {
                            nextItem = proj.items[i + 1]
                            //todo -subtotal based on a delimiter :: ?
                        }
                        let {hour, min} = time.toHourMin(item.time);
                        if (hour == 0) {
                            hour = chalk.grey(0)
                        }
                        let percent = Math.round(item.time / grandTotal * 100)
                        percent = prettifyPercent(percent, null,)
                        table.push(['', '', hour, min, percent, item.title.time_entry])
                    }
                }
                if (isLastClientRow) {
                    let {hour, min} = time.toHourMin(clientTotal);

                    let percent = Math.round(clientTotal / grandTotal * 100)
                    percent = prettifyPercent(percent, null, false, true)

                    let row = ['', {
                        hAlign: 'left',
                        content: chalk.bold('Subtotal:')
                    }, chalk.bold(hour), chalk.bold(min)]

                    row.push(percent)

                    table.push(row)
                }

            }
            table.push(['', {
                hAlign: 'left',
                content: chalk.bold.underline.cyan('Grand Total:')
            }, chalk.bold.underline.cyan(hour), chalk.bold.underline.cyan(min)]);
            return headerString1 + '\n' + headerString2 + '\n' + table.toString();

        }
    }
}

function printWeeklyLongReport(report, startDate, endDate) {

    //print each row
    let dayColumnHeaders = getColumnHeaders(startDate, endDate)
    let colAligns = Array(dayColumnHeaders.length + 1).fill('right');
    let table = new Table({
        // head: ['client','project','tag',...dayColumnHeaders,'total'],
        colAligns: ['', '', '', ...colAligns, 'right'],
        style: {head: ['green'], 'padding-left': 0, 'padding-right': 0, compact: true}
    })
    table.push(['client', 'project', 'tag', ...dayColumnHeaders, chalk.cyan.inverse('TOTAL'), {
        hAlign: 'right',
        content: chalk.grey('%')
    }])
    let clientNames = Object.keys(report.clients)
    for (let i = 0; i < clientNames.length; i++) {
        let clientName = clientNames[i];
        let client = report.clients[clientName]

        table.push([clientName])
        let projectNames = Object.keys(client.projects)
        // let projectMetadata = await toggl.getProjects();

        for (let j = 0; j < projectNames.length; j++) {
            let projectName = projectNames[j];
            let project = client.projects[projectName]
            // let pid = project.id
            let hexColour = project.hexColor;
            if (hexColour) {
                projectName = chalk.hex(hexColour)(projectName)
            }

            table.push(['', projectName])
            let tagNames = Object.keys(project.tags)
            for (let k = 0; k < tagNames.length; k++) {
                let tagName = tagNames[k];
                let tag = project.tags[tagName]
                let tagTotalRow = formatDayGroupTotalsRow(startDate, tag.dayGroupTotals, hexColour)

                table.push(['', '', tagName, ...tagTotalRow])
            }
            let projectTotalRow = formatDayGroupTotalsRow(startDate, project.dayGroupTotals, hexColour, {isProjectTotalRow: true})
            let projectLabel
            if (hexColour) {
                projectLabel = chalk.hex(hexColour).underline('Total:')
            } else {
                projectLabel = chalk.grey.underline('Total:')
            }
            let projectTotalLabel = {
                hAlign: 'right',
                content: projectLabel
            }
            table.push(['', '', projectTotalLabel, ...projectTotalRow])
        }
        let clientTotalRow = formatDayGroupTotalsRow(startDate, client.dayGroupTotals, null, {isClientTotalRow: true})
        let clientTotalLabel = {
            hAlign: 'right',
            content: chalk.bold('Client Total:')
        }

        table.push(['', '', clientTotalLabel, ...clientTotalRow])
    }
    table.push([])
    let grandTotalLabel = {
        hAlign: 'right',
        content: chalk.bold.cyan('Grand Total:')
    }
    let grandTotalRow = formatDayGroupTotalsRow(startDate, report.dayGroupTotals, null, {isGrandTotalRow: true})
    // let grandTotalRow = time.toHourMin(report.dayGroupTotals, {
    //     isDayGroupTotalsGroup: report.isDayGroupTotalsGroup,
    //     isGrandTotalRow: true
    // })

    table.push(['', '', grandTotalLabel, ...grandTotalRow])


    //print project totals
    //print client totals
    //print weekly totals
    //print monthly totals

    return table;

}

function prettifyPercent(percent, hexColour, isProjectTotalRow, isClientTotalRow, isGrandTotalRow) {
    let isTagTotalRow = (!isProjectTotalRow && !isClientTotalRow && !isGrandTotalRow)

    if (percent == null) {
    } else if (percent == 0) {
        percent = ''
    } else if (percent < 10) {
        percent = chalk.grey(percent + '%')
    } else if (percent >= 10) {
        if (hexColour) {
            if (isTagTotalRow) {
                percent = percent + '%'
            } else if (isProjectTotalRow) {
                percent = chalk.hex(hexColour)(percent + '%')
            }
        } else {
            if (isClientTotalRow) {
                percent = chalk.bold(percent + '%')
            } else if (isGrandTotalRow) {
                percent = percent + '%'
            }
        }
    }
    return percent
}

function formatDayGroupTotalsRow(startDate, dayGroupTotals, hexColour,
                                 {
                                     isProjectTotalRow = false,
                                     isClientTotalRow = false,
                                     isGrandTotalRow = false
                                 } = {}) {
    // if column is total or percent ...
    // if row is a total row ...

    // dayGroupTotals = [123456,123456,123456,0,100]
    // if ms, convert to hour min
    // if percent, print as percent
    //if grouptotal, print as total column

    let dow = startDate.day() //the week is 9 days long. 8th day = total, 9+th day = %

    let output = []
    for (i = 0; i < dayGroupTotals.length; i++) {
        let day = dow % 9
        let dayGroupTotal = dayGroupTotals[i];

        // the last week might end on tuesday, use array length to determine
        //where the percent column is for the last week
        let isLastWeekTotalColumn = (i == dayGroupTotals.length - 4)
        let isLastWeekPercentColumn = (i == dayGroupTotals.length - 3)

        //if we are at the last column (grand percent column)
        let isLastGrandTotalColumn = (i == dayGroupTotals.length - 2)
        let isLastGrandPercentColumn = (i == dayGroupTotals.length - 1)

        if (isLastWeekTotalColumn || isLastGrandTotalColumn) {
            let hourMin = time.toHourMin(dayGroupTotal)
            output.push(time.prettifyHourMin(hourMin, {
                hexColour,
                isProjectTotalRow,
                isClientTotalRow,
                isGrandTotalRow
            }))
        } else if (isLastGrandPercentColumn || isLastWeekPercentColumn) {
            let percent = prettifyPercent(dayGroupTotal, hexColour, isProjectTotalRow, isClientTotalRow, isGrandTotalRow)
            output.push(percent)
        } else {
            if (day == 0) { //percent
                let percent = prettifyPercent(dayGroupTotal, hexColour, isProjectTotalRow, isClientTotalRow, isGrandTotalRow)
                output.push(percent)
            } else if (1 <= day && day <= 7) {
                let hourMin = time.toHourMin(dayGroupTotal)
                output.push(time.prettifyHourMin(hourMin, {
                    hexColour,
                    isProjectTotalRow,
                    isClientTotalRow,
                    isGrandTotalRow,
                    day
                }))
            } else if (day == 8) { //total
                let hourMin = time.toHourMin(dayGroupTotal)
                output.push(time.prettifyHourMin(hourMin, {
                    hexColour,
                    isProjectTotalRow,
                    isClientTotalRow,
                    isGrandTotalRow
                }))
            }
        }
        dow++
    }
    return output
}


function subTotalFormat(hourMinArray) {
    //accept array of [{hour: h, min: m},..]
    return time.prettifyHourMin(hourMinArray)

}

function getColumnHeaders(startDate, endDate) {
    // return number of columns equal to days in startDate to endDate
    // add a Total column after every sunday

    let colHeaderArray = [];
    let colAlignArray = [];

    let start = startDate.clone().startOf('day');
    let end = endDate.clone().startOf('day')

    let week = 1;
    while (!start.isAfter(end)) {
        if (start.day() % 7 == 0 || start.day() % 7 == 6) {
            colHeaderArray.push('-')
        } else {
            colHeaderArray.push(start.format('ddDD'))
        }

        //if sunday or last day of report, add a total column
        if (start.day() % 7 == 0 || start.isSame(end)) {
            colHeaderArray.push(chalk.inverse(`  ${week}  `))
            colHeaderArray.push(chalk.grey('%'))
            week++
        }
        start.add(1, 'day').format('ddDD');
    }
    return colHeaderArray
}

function showHelp() {
    const helptext = fs.readFileSync(__dirname + '/help.txt', 'utf8');
    console.log(helptext);
    return true;
}

run();
