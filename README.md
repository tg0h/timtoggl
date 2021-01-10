# TODO
* env var for password
* ~~group time entries~~
* ~~sort by client and project~~
* sub total by client and project
* add time parameter for last week starting monday
* add client totals for the weekly report


#Design
should use a group object to store properties of the group.array
"group" instead of week - could be a group of 5 days or 7 days
the group has properties - 
* percentage
* total

dependencies:
* cli-table
* moment
* chalk
* node-fetch


