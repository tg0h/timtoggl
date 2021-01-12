const moment = require('moment');
const chalk = require('chalk');

let helper = {};

//todo: code smell converter and prettifier do the same thing ?
// convert to hour min
// format
// output
helper.toHourMin = function toHour(millis) {
    //to prettify, pass in prettifyOptions as second arg
    if (Array.isArray(millis)) { //if array of ms is passed in, convert to array of {hour,min}
        millis = millis.map((ms) => {
            return convert(ms)
        })
        return millis;
    } else {
        //if single hour min object
        return convert(millis);
    }

    function convert(ms) {
        let hour = Math.floor(ms / 1000 / 60 / 60);
        let min = Math.floor(ms / 1000 / 60 % 60);
        return {hour, min};
    }
}

helper.prettifyHourMin = function prettifyHourMin(hourMin, {
    hexColour = undefined,
    isClientTotalRow = false,
    isProjectTotalRow = false,
    tagTotal = false,
    isGrandTotalRow = false,
    // isDayGroupTotalsGroup = [],
    day = null
} = {}) {
    //add leading 0 to min
    //add colour to leading zero
    //isDayGroupTotalsGroup in an array of booleans. it tells you whether the column is a total column or not

    if (Array.isArray(hourMin)) {
        //if array of hourMin is passed in, prettify it as well
        // hourMin = hourMin.map((hm) => {
        //     return prettify(hm)
        // })

        for (let i = 0; i < hourMin.length; i++) {
            if (isDayGroupTotalsGroup.length > 0) {
                // hourMin[i] = prettify(hourMin[i], isDayGroupTotalsGroup[i])
            } else {
                hourMin[i] = prettify(hourMin[i], day)
            }
        }

        return hourMin;
    } else {
        return prettify(hourMin, day)
    }

    function prettify(hourMin, day, isGroupTotalColumn = false) {
        //if not group or percent column
        if (isGroupTotalColumn != null && !isGroupTotalColumn && hourMin.hour == 0 & hourMin.min == 0) {
            if (hexColour) {
                if (day == 6 || day == 7) {
                    return
                }
                if (isProjectTotalRow) {
                    return chalk.hex(hexColour)('____')
                } else if (isClientTotalRow) {

                } else if (isGrandTotalRow) {

                }
                return chalk.hex(hexColour)('-')
            } else {
                if (day == 6 || day == 7) {
                    return
                }
                return chalk.grey('-')
            }
        }

        //percent column
        if (isGroupTotalColumn == null) {
            return hourMin + '%'

        }

        let {hour, min} = hourMin

        if (min < 10) {
            min = '0' + min
        }
        min = chalk.grey(min)


        if (hour == 0) {
            hour = chalk.grey(hour)
        } else {
            if (isGroupTotalColumn) {
                return `${hour}:${min}`
            }
            if (hexColour) {
                hour = chalk.hex(hexColour)(hourMin.hour)
            }
            if (isClientTotalRow) {
                if (hour > 0) {
                    hour = chalk.bold(hour)
                }
            } else if (isGrandTotalRow) {
                if (hour > 0) {
                    hour = chalk.bold.cyan(hour)
                }
            }
        }


        return `${hour}:${min}`
    }
}

// helper.toMin = function toMin(ms){
//     let min = Math.floor(ms / 1000 / 60 % 60);
//     return min;
// }

helper.convertDate = function convertDate(dateParam, returnMoment) {

    //receives a time string and converts to epoch ts

    //if receive 5m, convert to epoch time 5 minutes ago
    //if receive 5d, convert to epoch time 5 days ago
    //if receive 5h, convert to epoch time 5 hours ago
    //if receive 0cw, return this week's monday
    //if receive 1cw, return last week's monday
    const Mwdhm = /(^\d+)(cm|cw|[wdhm]$)/ //only matches h(ours) d(ays) m(inutes) or cw (calendar week)
    const today = /^today$/
    const d2 = /(^\d{1,2})$/ //specify day only
    const d4 = /(^\d{1,2})(\d{2})$/ //specify day and month
    const d6 = /(^\d{1,2})(\d{2})(\d{2})$/ //specify day, month and year eg 140183 - 14 Jan 1983
    const d8 = /^(\d{1,2})(\d{2})?T(\d{1,2})(\d{2})?$/ //specify day, month, hour and min (optional) TODO: combine d2, d4 regex into d8 - problem: lazy match daypart
    // eg 19T12 - 19th of this month, 12pm
    // eg 19T23 - 19th of this month, 11pm
    // eg 19T1 - 19th of this month, 11pm
    const t4 = /^T?(\d{1,2})(\d{2})?H?$/ //specify hour

    let t;
    // let groups = date.match(regex)
    let date = String(dateParam);
    if (groups = date.match(Mwdhm)) {
        let amount = groups[1]
        let unit = groups[2] //hacky way to get environment
        switch (unit) {
            case 'm':
                t = moment().subtract(amount, 'minutes')
                break;
            case 'h':
                t = moment().subtract(amount, 'hours')
                break;
            case 'd':
                t = moment().subtract(amount, 'days')
                break;
            case 'w':
                t = moment().subtract(amount, 'weeks')
                break;
            case 'cw':
                t = moment().startOf('isoWeek').subtract(amount, 'weeks') //amount can be 0
                break;
            case 'cm':
                t = moment().startOf('month').subtract(amount, 'month') //amount can be 0
                break;
            case 'M':
                t = moment().subtract(amount, 'months')
                break;
            default:
                break;
        }
    } else if (groups = date.match(today)) { //date is true when d
        t = moment().startOf('day')
    } else if (groups = date.match(d2)) {
        let day = groups[1]
        t = moment(day, "DD"); //default to this month and year, default time to midnight 0000H
    } else if (groups = date.match(d4)) {
        let day = groups[1]
        let month = Number(groups[2]) - 1 // months are zero indexed in moment.js zzz
        t = moment({day: day, month: month})
    } else if (groups = date.match(d6)) {
        let day = groups[1]
        let month = Number(groups[2]) - 1 // months are zero indexed in moment.js zzz
        let year = 2000 + Number(groups[3])
        t = moment({day: day, month: month, year: year})
    } else if (groups = date.match(d8)) {
        let day = groups[1]
        let month = Number(groups[2]) - 1 // months are zero indexed in moment.js zzz
        let hour = groups[3]
        let min = groups[4]
        let dateConfig = {day: day}
        if (month >= 0 && month < 11) dateConfig.month = month;
        if (hour) dateConfig.hour = hour;
        if (min) dateConfig.minute = min;
        // verboseLog('moment dateConfig',dateConfig)
        t = moment(dateConfig)
    } else if (groups = date.match(t4)) {
        let hour = groups[1]
        let min = groups[2]
        let dateConfig = {hour: hour}
        if (min) {
            dateConfig.minute = min;
        }
        t = moment(dateConfig)
    }

    return t;
}

helper.convertRange = function convertRange(rangeParam) {

    //receives a range and returns a start and end moment
    //range comprises 2 parts - start and duration
    //1w1d -- 1 calendar week ago for duration of 1 day
    //1m1w -- 1 calendar month ago for duration of 1 week todo this might not make sense, eg 1 nov (eg wednesday) + 1 week ...
    //1mw -- 1 calendar month ago for duration of 1 week (if no duration number specified, assume 1 )
    //1m -- return 1st to last day of last month

    //todo
    //w1 -- the first week of the year
    //m1 -- the first month of the year
    //m12 -- the 12th month of the year


    let t;
    // let groups = date.match(regex)
    let range = String(rangeParam);

    const rangeRegex = /(^\d+)([mw])(\d*)([mw]?)$/ //only matches h(ours) d(ays) m(inutes) or cw (calendar week)
    if (groups = range.match(rangeRegex)) {
        let startLength = groups[1] //when does the range begin?
        let startUnit = groups[2]
        let durationLength = groups[3] == '' ? 1 : groups[3] //for how long does the range last?

        let isNoRangeGiven = false
        if (!groups[3] && !groups[4]) {
            isNoRangeGiven = true;
        }

        let durationUnit = groups[4]
        if (durationUnit == '') {
            durationUnit = startUnit
        }

        let start, end
        switch (startUnit) {
            case 'w':
                start = moment().startOf('isoWeek').subtract(startLength, 'weeks')
                break;
            case 'm':
                start = moment().subtract(startLength, 'months').date(1)
                break;
            default:
                break;
        }
        switch (durationUnit) {
            case 'w':
                end = start.clone().add(durationLength, 'weeks').subtract(1, 'day')
                break;
            case 'm':
                end = start.clone().add(durationLength, 'months').subtract(1, 'day')
                break;
            default:
                break;
        }
        t = {
            start,
            end
        }

    }

    return t;
}
module.exports = helper;

