const { Authenticator, GraphQLClient } = require('leanix-js')
// const { assert } = require('chai')

const lxr = require('../lxr.json')

const authenticator = new Authenticator(lxr.host, lxr.apitoken)
const graphql = new GraphQLClient(authenticator)

describe('Fetch Tagged Factsheets', function () {
  this.timeout(10000)

  it('fetches tagged factsheets', async () => {
    const config = {
      factSheetTypes: ['Application'],
      tagGroups: {
        'UX-Advocate': { aggregated: false },
        'Non UX-Advocate': { aggregated: true }
      }
    }
    await authenticator.start()
    const dataset = await Promise.all(await graphql.executeGraphQL(`query{op:allFactSheets{filterOptions{facets{facetKey keys:results{key name}}}}}`)
      .then(res => res.op.filterOptions.facets
        .filter(facetFilter => facetFilter.facetKey in config.tagGroups)
        .map(facetFilter => { facetFilter.keys = facetFilter.keys.filter(result => result.key !== '__missing__').map(result => result.key); return facetFilter })
        .map(facetFilter => { return {filter: {facetFilters: [{facetKey: 'FactSheetTypes', keys: config.factSheetTypes}, facetFilter]}} })
        .map(variables => graphql.executeGraphQL(`query($filter:FilterInput){op:allFactSheets(filter:$filter){edges{node{type tags{id name color tagGroup{name}}}}}}`, variables))
      )
    ).then(results => results
      .map(result => result.op.edges)
      .reduce((accumulator, edges) => Array.from([...accumulator, ...edges.map(edge => edge.node)]), [])
      .reduce((accumulator, node) => {
        if (!accumulator.hasOwnProperty(node.type)) accumulator[node.type] = {}
        const tags = node.tags || []
        tags.forEach(tag => {
          if (tag && tag.tagGroup) {
            if (!accumulator[node.type][tag.tagGroup.name]) accumulator[node.type][tag.tagGroup.name] = {}
            if (!accumulator[node.type][tag.tagGroup.name][tag.name]) accumulator[node.type][tag.tagGroup.name][tag.name] = {size: 0, color: tag.color}
            accumulator[node.type][tag.tagGroup.name][tag.name].size++
          }
        })
        return accumulator
      }, {})
    )

    const data = {
      name: 'root',
      children: Object.entries(dataset).map(([factSheetType, tagGroups]) => {
        return {
          name: factSheetType,
          children: Object.entries(tagGroups)
            .map(([tagGroupName, tags]) => {
              const isAggregated = config && config.tagGroups && config.tagGroups[tagGroupName] ? config.tagGroups[tagGroupName].aggregated : undefined
              const children = Object.entries(tags).map(([tagName, attributes]) => { return { name: tagName, ...attributes } })
              const node = { name: tagGroupName }
              isAggregated ? node.size = children.reduce((accumulator, child) => { accumulator += child.size || 0; return accumulator }, 0) : node.children = children
              return node
            })
        }
      })
    }
    /*
    const dataArray = Object.entries(dataset)
      .map(([factSheetType, tagGroups]) => Object.entries(tagGroups)
        .map(([tagGroupName, tags]) => Object.entries(tags)
          .map(([tagName, attributes]) => { return [`${factSheetType}::${tagGroupName}::${tagName}`, attributes] })))
      // .reduce((accumulator, tags) => Array.from([...accumulator, ...tags]), [])
    */
    authenticator.stop()
  })
})
