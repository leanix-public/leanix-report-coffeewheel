<template>
  <div id="app">
    <modal v-if="showConfigurationModal" @close="showConfigurationModal = false">
      <h3 slot="header">Report configuration</h3>
      <template slot="body">
        <div>
          <label>
            Show labels
            <input type="checkbox" v-model="showLabels"/>
          </label>
        </div>
      </template>
      <div slot="footer">
        <button @click="showConfigurationModal = false">OK</button>
      </div>
    </modal>
    <div v-if="loading" class="full-viewport-container" style="color: #303F9F">
      <div style="background: #009fdf; color: white; font-weigth: 300; font-size: 2em; width: 100%; display: flex; flex-flow: column; align-items: center;">
        <span style="padding: 1.5rem">Report is loading...</span>
        <font-awesome-icon icon="cog" size="2x" spin /><br>
      </div>
    </div>
    <chart-sunburst class="full-viewport-container" v-if="!loading" :data="chartData" :config="chartConfig"/>
  </div>
</template>

<script>
import Vue from 'vue'
import Modal from './components/Modal'
import { ChartSunburst } from 'vue-d2b'
import { hierarchy } from 'd3'
import chroma from 'chroma-js'

import { library } from '@fortawesome/fontawesome-svg-core'
import { faCog } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

library.add(faCog)

export default {
  name: 'App',
  components: { FontAwesomeIcon, ChartSunburst, Modal },
  data () {
    return {
      t0: performance.now(),
      loading: true,
      config: {},
      filter: {},
      dataset: [],
      viewModel: {},
      totalCount: 0,
      factsheetsIndex: {},
      taggedFactSheetCount: 0,
      showLabels: false,
      zooomable: false,
      subscriptionRoles: [],
      subscriptionRole: undefined,
      queryResults: {},
      filterableTagGroups: [],
      filteringTagGroup: undefined,
      reportConfig: undefined,
      showConfigurationModal: false,
      validTagGroups: []
    }
  },
  methods: {
    createReportConfig ({ factSheetType }) {
      const that = this
      return {
        allowTableView: false,
        menuActions: {
          showConfigure: true,
          configureCallback: () => {
            that.showConfigurationModal = true
          },
          customDropdowns: [
            {
              id: 'tagGroupFilterControl',
              name: 'View',
              initialSelectionEntryId: 'noSelection',
              entries: [
                {
                  id: 'noSelection',
                  name: '-- No Filter --',
                  callback: function () { that.filteringTagGroup = undefined }
                }
              ]
            }
          ]
        },
        facets: [{
          key: 'main',
          fixedFactSheetType: factSheetType,
          defaultPageSize: 1,
          facetFiltersChangedCallback: filter => {
            console.debug(`${Math.round(performance.now() - this.t0)}ms: facetFilterChangedCallback was triggered, setting filter variable`)
            this.filter = {
              facetFilters: filter.facets,
              fullTextSearch: filter.fullTextSearchTerm,
              ids: filter.directHits.map(hit => hit.id)
            }
          }
        }]
      }
    },
    fetchSubscriptionRoles () {
      const query = `{allSubscriptionRoles{edges{node{name}}}}`
      return this.$lx.executeGraphQL(query)
        .then(res => res.allSubscriptionRoles.edges.map(edge => edge.node.name))
        .catch(err => console.error(err))
    },
    fetchTagGroupsForSelectedFactSheetType () {
      console.debug(`${Math.round(performance.now() - this.t0)}ms: fetching filterable tagGroups for ${this.config.factSheetType}s`)
      const factSheetType = this.config.factSheetType
      const query = `{allTagGroups{edges{node{id name restrictToFactSheetTypes}}}}`
      return this.$lx.executeGraphQL(query)
        .then(res => {
          const validTagGroups = res.allTagGroups.edges.map(edge => edge.node).filter(node => !node.restrictToFactSheetTypes.length || node.restrictToFactSheetTypes.indexOf(factSheetType) > -1)
            .map(tagGroup => { delete tagGroup.restrictToFactSheetTypes; return tagGroup })
          console.debug(`${Math.round(performance.now() - this.t0)}ms: tagGroups for ${this.config.factSheetType}s are ${validTagGroups.map(tagGroup => tagGroup.name).join(', ')}`)
          return Promise.resolve(validTagGroups)
        })
        .catch(err => Promise.reject(err))
    },
    async fetchFactSheets () {
      const watchdogTimeout = setTimeout(() => {
        console.debug(`${Math.round(performance.now() - this.t0)}ms: watchdog timeout! re-fetching report dataset`)
        this.fetchFactSheets()
      }, 6000)
      console.debug(`${Math.round(performance.now() - this.t0)}ms: fetching report dataset`)
      this.$lx.showSpinner()
      this.loading = true
      this.validTagGroups = await this.fetchTagGroupsForSelectedFactSheetType().then(tagGroups => {
        const colorScale = chroma.scale(['#fafa6e', '#2A4858']).mode('lch').colors(tagGroups.length)
        return tagGroups.reduce((accumulator, tagGroup, idx) => {
          accumulator[tagGroup.name] = { ...tagGroup, fill: colorScale[idx] }
          return accumulator
        }, {})
      })
      const config = this.config
      // const filter = this.filter

      const tagsFragment = `tags{id name color tagGroup{name}}`
      const subscriptionsFragment = `subscriptionRoles:subscriptions{edges{node{roles{name}}}}`
      const variables = {
        filter: {
          facetFilters: [
            ...(this.filter.facetFilters || [{facetKey: 'FactSheetTypes', keys: [config.factSheetType]}])
          ],
          ids: (this.filter.ids || []),
          fullTextSearch: this.filter.fullTextSearch
        }
      }
      this.dataset = await Promise.all(
        // Get facetkeys for filtering by desired tagGroups
        await this.$lx.executeGraphQL(`query($filter:FilterInput){op:allFactSheets(filter:$filter){totalCount edges{node{id}} filterOptions{facets{facetKey keys:results{key name}}}}}`, variables)
          .then(res => {
            Vue.set(this.factsheetsIndex, 'all', res.op.edges.map(edge => edge.node.id))
            this.totalCount = res.op.totalCount
            return res.op.filterOptions.facets
              .filter(facetFilter => facetFilter.facetKey in this.validTagGroups)
              .map(facetFilter => { facetFilter.keys = facetFilter.keys.filter(result => result.key !== '__missing__').map(result => result.key); return facetFilter })
              .map(facetFilter => {
                console.debug(`${Math.round(performance.now() - this.t0)}ms: fetching filtering facetKeys for ${facetFilter.facetKey}`)
                return {
                  key: facetFilter.facetKey.replace(/[^0-9a-z]/gi, ''),
                  filter: {
                    facetFilters: [
                      facetFilter,
                      ...(this.filter.facetFilters || [{facetKey: 'FactSheetTypes', keys: [config.factSheetType]}])
                    ],
                    ids: (this.filter.ids || []),
                    fullTextSearch: this.filter.fullTextSearch
                  }
                }
              })
              .map(variables => this.$lx.executeGraphQL(`query($filter:FilterInput){${variables.key}:allFactSheets(filter:$filter){totalCount edges{node{id type ${subscriptionsFragment} ${tagsFragment}}}}}`, variables))
          })
      )
        .catch(err => {
          console.error('error while fetching fatcheets', err)
        })
      this.$lx.hideSpinner()
      this.loading = false
      console.debug(`${Math.round(performance.now() - this.t0)}ms: fetched report dataset`)
      clearTimeout(watchdogTimeout)
    },
    setConfig (config = {}) {
      config.factSheetType = (config.factSheetType === 'Default' || !config.factSheetType) ? 'Application' : config.factSheetType
      if (config.showUntaggedFactsheets === undefined) config.showUntaggedFactSheets = { label: 'Untagged', fill: '#eeeeee' }
      if (config.showUntaggedFactSheets) {
        if (typeof config.showUntaggedFactSheets === 'string') {
          config.showUntaggedFactSheets = {
            label: config.showUntaggedFactSheets,
            fill: '#eeeeee'
          }
        } else if (typeof config.showUntaggedFactSheets === 'boolean') {
          config.showUntaggedFactSheets = {
            label: 'Untagged',
            fill: '#eeeeee'
          }
        } else if (typeof config.showUntaggedFactSheets === 'object') {
          config.showUntaggedFactSheets = {
            label: config.showUntaggedFactSheets.label || 'Untagged',
            fill: config.showUntaggedFactSheets.fill || 'grey'
          }
        }
      }
      if (config.filterBySubscriptionRole) {
        // if the filterBySubscriptionRole attribute is set as an non-empty array
        if (Array.isArray(config.filterBySubscriptionRole) && config.filterBySubscriptionRole.length) {
          // set the list of filtering subscription roles accordingly
          this.subscriptionRoles = config.filterBySubscriptionRole
          // set the pre-defined subscription role filter with the first item of the list
          this.subscriptionRole = this.subscriptionRoles[0]
        } else {
          // if filterBySubscriptionRole is set as a string, set the pre-defined subscription role filter accordingly
          this.subscriptionRole = typeof config.filterBySubscriptionRole === 'string' ? config.filterBySubscriptionRole : ''
        }
      }
      this.showLabels = config.showLabels === undefined ? true : !!config.showLabels
      this.zoomable = !!config.zoomable
      this.config = config
    }
  },
  computed: {
    factSheetType () {
      return this.config && this.config.factSheetType ? this.config.factSheetType : ''
    },
    tagGroups () {
      return this.config && this.config.tagGroups ? Object.keys(this.config.tagGroups) : []
    },
    datasetHasNoChildren () {
      return this.chartData && ((Array.isArray(this.chartData.children) && !this.chartData.children.length) || !this.chartData.children)
    },
    chartData () {
      const config = this.config
      const subscriptionRole = this.subscriptionRole
      const filteringTagGroup = this.filteringTagGroup
      const dataset = JSON.parse(JSON.stringify(this.dataset)) // make a deep copy of this.dataset

      const tagGroupIndex = dataset.reduce((accumulator, result) => {
        Object.entries(result).forEach(([tagGroupName, taggedFactsheets]) => { Vue.set(this.factsheetsIndex, tagGroupName, taggedFactsheets.edges.map(edge => edge.node.id)) })
        accumulator = { ...accumulator, ...result }
        return accumulator
      }, {})

      const filteredFactSheetIndex = Object.entries(tagGroupIndex)
        .map(([tagGroupName, factSheets]) => [tagGroupName, factSheets.edges.map(edge => edge.node)])
        .reduce((accumulator, [tagGroupName, nodes]) => {
          nodes.map(node => {
            node.subscriptionRoles = (node.subscriptionRoles.edges || [])
              .map(edge => edge.node.roles).filter(roles => roles !== null)
              .reduce((accumulator, roles) => Array.from(new Set([...accumulator, ...roles.map(role => role.name)])), [])
            return node
          })
            .forEach(node => {
              if (!accumulator.hasOwnProperty(node.type)) accumulator[node.type] = {}
              const tags = node.tags || []
              if (!subscriptionRole || (subscriptionRole && node.subscriptionRoles.includes(subscriptionRole))) {
                tags.filter(tag => tag.tagGroup && tag.tagGroup.name.replace(/\s/g, '') === tagGroupName)
                  .forEach(tag => {
                    if (!accumulator[node.type][tag.tagGroup.name]) accumulator[node.type][tag.tagGroup.name] = {}
                    if (!accumulator[node.type][tag.tagGroup.name][tag.name]) accumulator[node.type][tag.tagGroup.name][tag.name] = {size: 0, fill: tag.color}
                    accumulator[node.type][tag.tagGroup.name][tag.name].size++
                  })
              }
            })
          return accumulator
        }, {})

      let output = {
        label: 'FactSheets',
        children: Object.entries(filteredFactSheetIndex)
          .map(([factSheetType, tagGroups]) => {
            if (filteringTagGroup) {
              const _tagGroups = {}
              _tagGroups[filteringTagGroup] = tagGroups[filteringTagGroup]
              tagGroups = _tagGroups
            } else {
              tagGroups = {}
            }
            return [factSheetType, tagGroups]
          })
          .map(([factSheetType, tagGroups]) => {
            const fill = this.viewModel[factSheetType] ? this.viewModel[factSheetType].bgColor : '#000'
            const color = this.viewModel[factSheetType] ? this.viewModel[factSheetType].color : '#fff'
            return {
              label: `${factSheetType}s`,
              fill,
              color,
              children: Object.entries(tagGroups)
                .filter(([tagGroupName, tags]) => this.validTagGroups.hasOwnProperty(tagGroupName))
                .map(([tagGroupName, tags]) => {
                  const { fill, color, aggregated } = this.validTagGroups[tagGroupName]
                  const children = tags ? Object.entries(tags).map(([tagName, attributes]) => { return { label: tagName, ...attributes } }) : []
                  const node = { label: tagGroupName, tagGroup: true, fill, color }
                  aggregated ? node.size = children.reduce((accumulator, child) => { accumulator += child.size || 0; return accumulator }, 0) : node.children = children
                  return node
                })
            }
          })
      }
      output = output.children && output.children.length
        ? output.children[0]
        : {
          label: `${this.factSheetType}s`,
          fill: this.viewModel[this.factSheetType] ? this.viewModel[this.factSheetType].bgColor : '#000',
          color: this.viewModel[this.factSheetType] ? this.viewModel[this.factSheetType].color : '#fff'
        }
      const taggedFactsheetIDs = Object.keys(config.tagGroups || {})
        .map(tagGroupName => tagGroupName.replace(/\s/g, ''))
        .filter(tagGroupName => this.factsheetsIndex.hasOwnProperty(tagGroupName))
        .reduce((accumulator, tagGroupName) => new Set([...accumulator, ...this.factsheetsIndex[tagGroupName]]), new Set())
      if (config.showUntaggedFactSheets) {
        const factsheetsIndexAll = this.factsheetsIndex && this.factsheetsIndex.all ? this.factsheetsIndex.all : []
        const allFactsheetIDs = Array.from(new Set([...factsheetsIndexAll]))
        if (!output.children) output.children = []
        if (!subscriptionRole && !filteringTagGroup) {
          const untaggedFactsheetIDs = Array.from(new Set([...allFactsheetIDs].filter(x => !taggedFactsheetIDs.has(x)))) // Unique factsheets which do not belong to a specified tagGroup
          output.children.push({ ...config.showUntaggedFactSheets, size: untaggedFactsheetIDs.length })
        } else {
          const tagCount = hierarchy(output).sum(d => d.size || 0).value
          if (filteringTagGroup) {
            output.children.push({ ...config.showUntaggedFactSheets, label: `${filteringTagGroup} n/a`, size: this.totalCount - tagCount })
          } else {
            output.children.push({ ...config.showUntaggedFactSheets, size: this.totalCount - tagCount })
          }
        }
      }
      if (!filteringTagGroup) {
        output.children = [{ label: '', size: this.totalCount, fill: 'transparent', hidden: true }]
      }
      return output
    },
    chartConfig () {
      const tipTemplate = d => {
        const percentage = parseFloat((d.value / this.totalCount) * 100).toFixed(1)
        const percentText = `<div class="d2b-sunburst-percent">${percentage}%</div>`
        return `
        <div class="d2b-sunburst-label">
          ${d.label}
        </div>
        <div class="d2b-sunburst-value">
          ${d.value}
          ${percentText}
        </div>`
      }
      const showLabels = this.showLabels
      const zoomable = this.zoomable

      return chart => {
        chart
          .color(d => d.fill)
        chart.sunburst()
          .zoomable(() => zoomable)
          .showLabels(() => showLabels)
          .size(d => d.label === this.factSheetType + 's' ? this.totalCount : d.hidden ? 0 : d.size)
        chart.tooltip()
          .followMouse(true)
          .html(d => `<div class="d2b-sunburst-tooltip">${tipTemplate(d)}</div>`)

        chart.breadcrumbs()
          .html(d => `<div class="d2b-sunburst-breadcrumb">${tipTemplate(d)}</div>`)
      }
    }
  },
  watch: {
    filter (val, oldVal) {
      console.debug(`${Math.round(performance.now() - this.t0)}ms: filter variable changed, triggering the fetching of report dataset`)
      this.fetchFactSheets()
    },
    filterableTagGroups (tagGroups) {
      // const cancelFilter = { id: 'noSelection', name: '-- No Filter --', callback: () => { this.filteringTagGroup = undefined } }
      const tagGroupFilterControl = this.reportConfig.menuActions.customDropdowns.filter(control => control.id === 'tagGroupFilterControl').shift()
      const sortedTagGroups = Array.from([...tagGroups])
        .sort((a, b) => { return (a.name < b.name) ? -1 : (a.name > b.name) ? 1 : 0 })
        .map(tagGroup => { return { ...tagGroup, callback: () => { this.filteringTagGroup = tagGroup.name } } })
      // tagGroupFilterControl.entries = [...sortedTagGroups, cancelFilter]
      // tagGroupFilterControl.initialSelectionEntryId = sortedTagGroups.length ? sortedTagGroups[0].id : 'noSelection'
      tagGroupFilterControl.entries = sortedTagGroups
      tagGroupFilterControl.initialSelectionEntryId = sortedTagGroups.length ? sortedTagGroups[0].id : undefined
      if (sortedTagGroups.length) {
        sortedTagGroups[0].callback()
      }
      console.debug(`${Math.round(performance.now() - this.t0)}ms: updating report configuration with filtering tagGroups`)
      this.$lx.updateConfiguration(this.reportConfig)
    }
  },
  created () {
    console.debug(`${Math.round(performance.now() - this.t0)}ms: report created`)
  },
  mounted () {
    console.debug(`${Math.round(performance.now() - this.t0)}ms: report mounted`)
    this.$lx.init()
      .then(setup => {
        // console.debug('report setup', JSON.parse(JSON.stringify(setup)))
        this.viewModel = setup && setup.settings && setup.settings.viewModel && setup.settings.viewModel.factSheets
          ? setup.settings.viewModel.factSheets.reduce((accumulator, factSheet) => { accumulator[factSheet.type] = factSheet; return accumulator }, {})
          : {}
        this.setConfig(setup.config)
        this.reportConfig = this.createReportConfig({ factSheetType: this.config.factSheetType })
        this.$lx.ready(this.reportConfig)
        // If we have not yet set the subscription roles list from the config object, fetch it from the server (subscriptionRoles set by this.setConfig method)
        const requests = [this.fetchTagGroupsForSelectedFactSheetType()]
        requests.push(this.subscriptionRoles.length ? Promise.resolve(this.subscriptionRoles) : this.fetchSubscriptionRoles())
        return Promise.all(requests)
      })
      .then(([tagGroups, subscriptionRoles]) => {
        this.subscriptionRoles = subscriptionRoles
        this.filterableTagGroups = tagGroups
        console.debug(`${Math.round(performance.now() - this.t0)}ms: filterable tagGroups are set in the report`)
      })
      .catch(err => {
        console.error('error while fetching subscription roles and filterable tag groups', err)
      })
  }
}
</script>

<style lang='stylus'>
#app
  font-family: Helvetica Neue,Helvetica,Arial,sans-serif
  font-size: 12px
  -webkit-font-smoothing: antialiased
  -moz-osx-font-smoothing: grayscale
  color: #333

.d2b-sunburst
  &-percent,&-label,&-value,&-tooltip,&-breadcrumb
    font-family: Helvetica Neue,Helvetica,Arial,sans-serif
  &-value
    font-size 1rem !important
  &-percent
    font-size 0.8rem

.full-viewport-container
  position fixed
  height 100vh
  width 100%
  display flex
  flex-flow column
  align-items center
  justify-content center
  text-align center

.vue-d2b-container
  height calc(100vh - 45px) !important

.controls-containter
  display flex
  flex-flow column
</style>

<style>
.fade-enter-active, .fade-leave-active {
  transition: opacity 1s;
}
.fade-enter, .fade-leave-to /* .fade-leave-active below version 2.1.8 */ {
  opacity: 0;
}
</style>
