import { libErrors, libLink, libLogging, libPlugin } from "@clusterio/lib";
const { logger } = libLogging;
import packageJson from "../../package.json";


/**
 * Connector for control connection to master server
 * @private
 */
export class ControlConnector extends libLink.WebSocketClientConnector {
	constructor(url, maxReconnectDelay) {
		super(url, maxReconnectDelay);
		this.token = null;
	}

	register() {
		if (!this.token) {
			throw new Error("Token not set");
		}

		logger.verbose("Connector | registering control");
		this.sendHandshake("register_control", {
			token: this.token,
			agent: "Clusterio Web UI",
			version: packageJson.version,
		});
	}
}

/**
 * Handles running the control
 *
 * Connects to the master server over WebSocket and sends commands to it.
 * @static
 */
export class Control extends libLink.Link {
	constructor(connector, plugins) {
		super("control", "master", connector);
		libLink.attachAllMessages(this);

		/**
		 * Mapping of plugin names to their instance for loaded plugins.
		 * @type {Map<string, module:lib/plugin.BaseWebPlugin>}
		 */
		this.plugins = plugins;
		for (let plugin of plugins.values()) {
			plugin.control = this;
			libPlugin.attachPluginMessages(this, plugin);
		}

		/**
		 * Flag indicating the connection is in the process of logging out.
		 * @type {boolean}
		 */
		this.loggingOut = false;

		/**
		 * Name of the account this control link is connected as.
		 * @type {?string}
		 */
		this.accountName = null;

		this.slaveUpdateHandlers = new Map();
		this.instanceUpdateHandlers = new Map();
		this.saveListUpdateHandlers = new Map();
		this.instanceLogHandlers = new Map();

		this.connector.on("connect", data => {
			this.accountName = data.account.name;
			this.updateSlaveSubscriptions().catch(err => logger.error(
				`Unexpected error updating slave subscriptions:\n${err.stack}`
			));
			this.updateInstanceSubscriptions().catch(err => logger.error(
				`Unexpected error updating instance subscriptions:\n${err.stack}`
			));
			this.updateSaveListSubscriptions().catch(err => logger.error(
				`Unexpected error updating save list subscriptions:\n${err.stack}`
			));
			this.updateLogSubscriptions().catch(err => logger.error(
				`Unexpected error updating log subscriptions:\n${err.stack}`
			));
		});

		this.connector.on("close", () => {
			this.accountName = null;
		});

		for (let event of ["connect", "drop", "resume", "close"]) {
			this.connector.on(event, () => {
				for (let plugin of this.plugins.values()) {
					plugin.onMasterConnectionEvent(event);
				}
			});
		}
	}

	async slaveUpdateEventHandler(message) {
		let handlers = [].concat(
			this.slaveUpdateHandlers.get(null) || [],
			this.slaveUpdateHandlers.get(message.data.id) || [],
		);
		for (let handler of handlers) {
			handler(message.data);
		}
	}

	async onSlaveUpdate(id, handler) {
		if (id !== null && !Number.isInteger(id)) {
			throw new Error("Invalid slave id");
		}

		let handlers = this.slaveUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.slaveUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateSlaveSubscriptions();
		}
	}

	async offSlaveUpdate(id, handler) {
		let handlers = this.slaveUpdateHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for slave ${id} exists`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for slave ${id}`);
		}

		handlers.slice(index, 1);
		if (!handlers.length) {
			this.slaveUpdateHandlers.delete(id);
			await this.updateSlaveSubscriptions();
		}
	}

	async updateSlaveSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setSlaveSubscriptions.send(this, {
			all: this.slaveUpdateHandlers.has(null),
			slave_ids: [...this.slaveUpdateHandlers.keys()].filter(e => e !== null),
		});
	}

	async instanceUpdateEventHandler(message) {
		let handlers = [].concat(
			this.instanceUpdateHandlers.get(null) || [],
			this.instanceUpdateHandlers.get(message.data.id) || [],
		);
		for (let handler of handlers) {
			handler(message.data);
		}
	};

	async onInstanceUpdate(id, handler) {
		if (id !== null && !Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.instanceUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.instanceUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateInstanceSubscriptions();
		}
	}

	async offInstanceUpdate(id, handler) {
		let handlers = this.instanceUpdateHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for instance ${id} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			this.instanceUpdateHandlers.delete(id);
			await this.updateInstanceSubscriptions();
		}
	}

	async updateInstanceSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setInstanceSubscriptions.send(this, {
			all: this.instanceUpdateHandlers.has(null),
			instance_ids: [...this.instanceUpdateHandlers.keys()].filter(e => e !== null),
		});
	}

	async saveListUpdateEventHandler(message) {
		let handlers = this.saveListUpdateHandlers.get(message.data.instance_id);
		for (let handler of handlers || []) {
			handler(message.data);
		}
	};

	async onSaveListUpdate(id, handler) {
		if (!Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.saveListUpdateHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.saveListUpdateHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateSaveListSubscriptions();
		}
	}

	async offSaveListUpdate(id, handler) {
		let handlers = this.saveListUpdateHandlers.get(id);
		if (!handlers) {
			throw new Error(`No handlers for instance ${id} exists`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);

			handlers.splice(index, 1);
			if (!handlers.length) {
				this.saveListUpdateHandlers.delete(id);
				await this.updateSaveListSubscriptions();
			}
		}
	}

	async updateSaveListSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setSaveListSubscriptions.send(this, {
			all: false,
			instance_ids: [...this.saveListUpdateHandlers.keys()],
		});
	}

	async logMessageEventHandler(message) {
		let info = message.data.info;

		if (info.instance_id !== undefined) {
			let instanceHandlers = this.instanceLogHandlers.get(info.instance_id);
			for (let handler of instanceHandlers || []) {
				handler(info);
			}
		}
	}

	async onInstanceLog(id, handler) {
		if (!Number.isInteger(id)) {
			throw new Error("Invalid instance id");
		}

		let handlers = this.instanceLogHandlers.get(id);
		if (!handlers) {
			handlers = [];
			this.instanceLogHandlers.set(id, handlers);
		}

		handlers.push(handler);

		if (handlers.length === 1) {
			await this.updateLogSubscriptions();
		}
	}

	async offInstanceLog(id, handler) {
		let handlers = this.instanceLogHandlers.get(id);
		if (!handlers || !handlers.length) {
			throw new Error(`No handlers for instance ${id} exist`);
		}

		let index = handlers.lastIndexOf(handler);
		if (index === -1) {
			throw new Error(`Given handler is not registered for instance ${id}`);
		}

		handlers.splice(index, 1);
		if (!handlers.length) {
			await this.updateLogSubscriptions();
		}
	}

	async updateLogSubscriptions() {
		if (!this.connector.connected) {
			return;
		}

		await libLink.messages.setLogSubscriptions.send(this, {
			all: false,
			master: false,
			slave_ids: [],
			instance_ids: [...this.instanceLogHandlers.keys()],
			max_level: null,
		});
	}

	async debugWsMessageEventHandler(message) {
		// eslint-disable-next-line no-console
		console.log("WS", message.data.direction, message.data.content);
	}

	async shutdown() {
		try {
			await libLink.messages.prepareDisconnect.send(this);
		} catch (err) {
			if (!(err instanceof libErrors.SessionLost)) {
				throw err;
			}
		}

		await this.connector.close(1000, "Control Quit");
	}
}
