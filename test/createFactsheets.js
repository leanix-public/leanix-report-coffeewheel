const { Authenticator, GraphQLClient } = require('leanix-js')
const { assert } = require('chai')
// const async = require('async')
const Chance = require('chance')
const chance = new Chance()
const chalk = require('chalk')
const lxr = require('../lxr.json')

const authenticator = new Authenticator(lxr.host, lxr.apitoken)
const graphql = new GraphQLClient(authenticator)

describe('Create Test FactSheets', function () {
  this.timeout(10000)
  it('lxr object is valid', () => {
    assert.isDefined(lxr)
    assert.hasAllKeys(lxr, ['host', 'apitoken'])
  })

  it('deletes all factsheets in workspace', async () => {
    const query = `mutation($id:ID!,$comment:String,$patches:[Patch]!){op:updateFactSheet(id:$id,comment:$comment,patches:$patches){factSheet{id}}}`
    const variables = {id: '', comment: 'archived', patches: [{ op: 'add', path: '/status', value: 'ARCHIVED' }]}

    const token = await authenticator.start()
    assert.isString(token)
    assert.isTrue(authenticator.isRunning)
    const res = await graphql.executeGraphQL(`{op:allFactSheets{edges{node{id}}}}`)
    const ids = res.op.edges.map(edge => edge.node.id)
    console.log(chalk.blue(`There are ${ids.length} factsheet${ids.length === 1 ? '' : 's'} in the workspace`))

    /*
    for (const id of ids) {
      await graphql.executeGraphQL(query, { ...variables, id })
      console.log(`Factsheet ${id} was deleted`)
    }
    */

    ids.reduce((promiseChain, id) => promiseChain.then(() => { console.log(`Deleting Factsheet ${id}`); graphql.executeGraphQL(query, { ...variables, id }) }), Promise.resolve())
      .then(() => {
        console.log(`${ids.length} factsheets have been deleted`)
        authenticator.stop()
        assert.isFalse(authenticator.isRunning)
      })
  })

  it('creates N tagged factsheets in the workspace', async () => {
    // Number of factsheets to be created
    const N = 300
    const query = `mutation($input:BaseFactSheetInput!, $patches:[Patch]){createFactSheet(input:$input, patches:$patches){factSheet{id}}}`

    const token = await authenticator.start()
    assert.isString(token)
    assert.isTrue(authenticator.isRunning)
    const res = await graphql.executeGraphQL(`query{op:allTags{asList{id name color tagGroup {id name}}}}`)
    /*
    // https://stackoverflow.com/questions/8435183/generate-a-weighted-random-number
    const tagGroupIndex = res.op.asList
      .reduce((accumulator, tag) => {
        if (!accumulator[tag.tagGroup.id]) accumulator[tag.tagGroup.id] = { name: tag.tagGroup.name, tags: {} }
        accumulator[tag.tagGroup.id].tags[tag.id] = { name: tag.name }
        return accumulator
      }, {})
    */
    // Get the array of tag ids
    const tagIDs = res.op.asList.reduce((accumulator, tag) => Array.from(new Set([...accumulator, tag.id])), [])

    const variablesArray = [...Array(N).keys()]
      .map(() => {
        return {
          input: {
            name: chance.name(),
            type: 'Application'
          },
          patches: [
            {op: 'replace', path: '/tags', value: `[{"tagId":"${tagIDs[Math.floor(Math.random()*tagIDs.length)]}"}]`}
          ]
        }
      })

    variablesArray.reduce((promiseChain, variables) => promiseChain.then(() => { console.log(`Creating factsheet ${variables.input.name}`); graphql.executeGraphQL(query, { ...variables }) }), Promise.resolve())
      .then(() => {
        console.log(`${variablesArray.length} factsheets have been created`)
        authenticator.stop()
        assert.isFalse(authenticator.isRunning)
      })
  })
})
