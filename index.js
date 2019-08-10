const { TeamSpeak, ClientType } = require('ts3-nodejs-library')
const humanizeDuration = require('humanize-duration')
const Database = require('better-sqlite3')

class User {
  constructor (id, totalTime) {
    this.id = id
    this.totalTime = totalTime
    this.connectionTime = 0
  }

  addTime (connectionTime) {
    const timeToAdd = Math.max(0, connectionTime - this.connectionTime)
    this.totalTime += timeToAdd
    this.connectionTime = connectionTime
    return timeToAdd
  }

  get hoursOnline () {
    return this.totalTime / (60 * 60 * 1000)
  }

  get rank () {
    return Math.floor(Math.log(this.hoursOnline) / Math.log(1.55))
  }

  get rankGroup () {
    return 14 + this.rank
  }

  get timeToPromotion () {
    const hoursToPromotion = Math.pow(1.55, this.rank + 1) - Math.pow(1.55, this.rank)
    return hoursToPromotion * 60 * 60 * 1000
  }
}

class Yuki {
  constructor () {
    this.users = new Map()
    this.initializeDatabase()
  }

  initializeDatabase () {
    this.db = new Database('database.sqlite3')
    this.db.prepare('CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY NOT NULL, totalTime INT NOT NULL)').run()
  }

  async start () {
    this.ts = await TeamSpeak.connect({
      host: process.env.TEAMSPEAK_HOST,
      username: process.env.TEAMSPEAK_USER,
      password: process.env.TEAMSPEAK_PASSWORD,
      nickname: process.env.TEAMSPEAK_NICKNAME,
      queryport: 10011,
      serverport: 9987,
      keepalive: true,
      readyTimeout: 5000
    })

    await this.ts.registerEvent('server')

    this.ts.on('clientconnect', this.onClientConnect.bind(this))
    this.ts.on('clientdisconnect', this.onClientDisconnect.bind(this))

    setInterval(this.checkClientList.bind(this), 5000)

    console.log('Ready')
  }

  onClientConnect ({ client }) {
    const user = this.getUser(client)
    client.message(`\nWitaj na serwerze [b]Zielona Dioda[/b]!\nTwoja obecna ranga to [b]${user.rank}[/b] - spędziłeś z nami ${humanizeDuration(user.totalTime, { round: true, language: 'pl' })}\nCzas pozostały do kolejnej rangi to [b]${humanizeDuration(user.timeToPromotion, { round: true, language: 'pl' })}[/b]`)
    console.log(`${client.nickname} connected - ${humanizeDuration(user.totalTime, { round: true })}`)
  }

  onClientDisconnect ({ client }) {
    this.removeUser(client)
    console.log(`${client.client_nickname || 'unknown'} disconnected`)
  }

  getUser (client) {
    if (!this.users.has(client.clid)) this.addUser(client)
    return this.users.get(client.clid)
  }

  addUser (client) {
    const databaseUser = this.db.prepare('SELECT * FROM users WHERE id = :id').get({ id: client.databaseId })
    if (!databaseUser) this.db.prepare('INSERT INTO users (id, totalTime) VALUES (:id, :totalTime)').run({ id: client.databaseId, totalTime: 0 })

    this.users.set(client.clid, new User(client.databaseId, databaseUser ? databaseUser.totalTime : 0))
  }

  removeUser (client) {
    this.users.delete(client.clid)
  }

  async checkClientList () {
    const clientList = await this.ts.clientList({ client_type: ClientType.Regular })
    for (const client of clientList) await this.updateClient(client)
  }

  async updateClient (client) {
    const connectionTime = Date.now() - client.lastconnected * 1000

    const user = this.getUser(client)
    user.addTime(connectionTime)

    await this.updateGroups(client, user)
    this.saveUser(user)
  }

  async updateGroups (client, user) {
    if (!client.servergroups.length) await client.addGroups(47)

    const clientRankGroups = client.servergroups.filter(groupId => groupId >= 14 && groupId <= 46)

    if (!clientRankGroups.includes(user.rankGroup)) {
      await client.addGroups(user.rankGroup)
      client.message(`Gratuluję! Twoja nowa ranga to [b]${user.rank}[/b], czas pozostały do kolejnej rangi to [b]${humanizeDuration(user.timeToPromotion, { round: true, language: 'pl' })}[/b]`)
    }

    const unnecessaryGroups = clientRankGroups.filter(groupId => groupId !== user.rankGroup)
    if (unnecessaryGroups.length) await client.delGroups(unnecessaryGroups)
  }

  saveUser (user) {
    this.db.prepare('UPDATE users SET totalTime = :totalTime WHERE id = :id').run({ id: user.id, totalTime: user.totalTime })
  }
}

const yuki = new Yuki()
yuki.start()
