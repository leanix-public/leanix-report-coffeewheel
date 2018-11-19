# coffeewheel

> LeanIX custom report build with Vue.js.

## Build Setup

``` bash
# install dependencies
npm install

# serve with hot reload at localhost:8080
npm run dev

# build for production with minification
npm run build

# build for production and view the bundle analyzer report
npm run build --report

# upload report to LeanIX
npm run upload
```

For a detailed explanation on how things work, check out the [guide](http://vuejs-templates.github.io/webpack/) and [docs for vue-loader](http://vuejs.github.io/vue-loader).

## Report Configuration
This report can be configured according the specifications defined by its config object. Find below an example for the report standard configuration.

```json
{
  "factSheetType": "Application",
  "showUntaggedFactSheets": {
    "label": "Untagged",
    "fill": "grey"
  },
  "showLabels": true,
  "zoomable": false
}
```

Properties
----------

| Name                        | Type                                | Required | Default value                    | Info                                                                                                   |
| --------------------------- | ----------------------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **factSheetType**           | String                              | No       | Application                      | Factsheet type used in the report analysis                                                             |
| **showUntaggedFactSheets**  | Boolean or Object                   | No       | {label: 'Untagged', fill: 'grey'}| If set, displays the untagged factsheet information as a separate arc in the middle ring of the report.|
| **showLabels**              | Boolean                             | No       | true                           | If true, shows labels for each report arc                                                              |
| **zoomable**                | Boolean                             | No       | false                          | If true, enables zoom behaviour when clicking on the report arcs                                       |

## Notes

1. The tag group count, shown for each arc on the second ring of the report, **does not represent the number of unique factsheets** within a tag group. Instead, represents the count of tags within that tag group, which may be higher than the number of unique factsheets, as a single factsheet may be tagged multiple times within the same tag group.
