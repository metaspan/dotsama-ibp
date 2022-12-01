
import moment from 'moment'
import { DataTypes, Op, Sequelize, Model } from 'sequelize'

import { monitorModel } from '../models/monitor.js'
import { serviceModel } from '../models/service.js'
import { peerModel } from '../models/peer.js'
import { healthCheckModel } from '../models/healthCheck.js'
import { logModel } from '../models/log.js'

import { config } from '../config.js'
import { configLocal } from '../config.local.js'
const cfg = Object.assign(config, configLocal)
const sequelize = new Sequelize(cfg.sequelize.database, cfg.sequelize.username, cfg.sequelize.password, cfg.sequelize.options)

class DataStore {

  Service = undefined
  Peer = undefined
  HealthCheck = undefined
  Log = undefined
  pruning = {
    age: 90 * 24 * 60 * 60, // days as seconds
    interval: 1 * 24 * 60 * 60 // 1 day as seconds
  }

  constructor(config = {}) {
    console.debug('DataStore()', config)
    this.pruning = Object.assign(this.pruning, config.pruning)
    const Monitor = sequelize.define('monitor', monitorModel.definition, { ...monitorModel.options, sequelize })
    const Peer = sequelize.define('peer', peerModel.definition, { ...peerModel.options, sequelize })
    const Service = sequelize.define('service', serviceModel.definition, { ...serviceModel.options, sequelize })
    const HealthCheck = sequelize.define('health_check', healthCheckModel.definition, { ...healthCheckModel.options, sequelize })
    const Log = sequelize.define('log', logModel.definition, { ...logModel.options, sequelize })
    // const MonitorService = sequelize.define('monitor_service', {}, { timestamps: false })

    Peer.hasOne(Service, { as: 'service', foreignKey: 'peerId' })
    Peer.hasMany(HealthCheck, { as: 'healthChecks', foreignKey: 'peerId' })

    Service.hasMany(Peer, { foreignKey: 'serviceUrl', otherKey: 'peerId', onDelete: 'NO ACTION', onUpdate: 'CASCADE' })
    Service.hasMany(HealthCheck, { as: 'healthChecks', foreignKey: 'serviceUrl', onDelete: 'NO ACTION', onUpdate: 'CASCADE' })

    Service.belongsToMany(Monitor, { as: 'monitors', through: 'monitor_service', foreignKey: 'serviceUrl', otherKey: 'monitorId' })
    Monitor.belongsToMany(Service, { as: 'services', through: 'monitor_service', foreignKey: 'monitorId', otherKey: 'serviceUrl' })

    HealthCheck.belongsTo(Monitor, { foreignKey: 'monitorId' })
    HealthCheck.belongsTo(Peer, { foreignKey: 'peerId' })
    HealthCheck.belongsTo(Service, { foreignKey: 'serviceUrl' })

    Log.belongsTo(Peer, { foreignKey: 'peerId' })
    Log.belongsTo(Service, { foreignKey: 'serviceUrl' })

    this.Monitor = Monitor
    this.Peer = Peer
    this.Service = Service
    this.HealthCheck = HealthCheck
    this.Log = Log

    if (config.initialiseDb) {
      this.sync()
    }

  }

  async sync () {
    console.debug('Syncing model structure to DB')
    await this.Peer.sync({ alter: true })
    await this.Service.sync({ alter: true })
    await this.HealthCheck.sync({ alter: true })
    await this.Log.sync({ alter: true })
    await sequelize.sync({ force: true });

    // console.debug('Creating models')
    // const [svc, _1] = await this.Service.upsert({
    //   serviceId: 'service2123',
    //   url: 'wss://test.com',
    // })
    // console.log('svc', svc)
    // const [peer, _2] = await this.Peer.upsert({
    //     peerId: 'peer123123',
    //     name: 'Test Peer'
    // })
    // await svc.setPeers(['peer123123'])
  }

  async close () {
    console.debug('Closing datastore...')
    return await sequelize.close()
  }

  async log(level='info', data) {
    const model = {
      level, data
    }
    return this.Log.create(model)
  }

  async prune () {
    console.debug('DataStore.prune()', this.pruning)
    const marker = moment().add(-(this.pruning.age), 'seconds')
    var result
    result = await this.HealthCheck.destroy({ where: { createdAt: { [Op.lt]: marker } } })
    console.debug('HealthCheck.destroy', result)
    result = await this.Service.update({ status: 'stale' }, { where: { errorCount: { [Op.gt]: 10 } } })
    console.debug('Service.stale', result)
  }

}

export {
  DataStore
}
