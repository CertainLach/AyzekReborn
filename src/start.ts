import Logger from "@meteor-it/logger";
import ConsoleReceiver from '@meteor-it/logger/receivers/node';
import DiscordApi from "./api/discord/api";
import VKApi from "./api/vk/api";
import TelegramApi from "./api/telegram/api";
import { Ayzek } from "./bot/ayzek";
import ModernPluginSystem from "./bot/pluginSystems/ModernPluginSystem";
import * as config from "./config.yaml";
import { Api } from "./model/api";

Logger.addReceiver(new ConsoleReceiver());

function parseApi(apiDesc: any) {
	if (!apiDesc.type) throw new Error('Missing api type');
	if (!apiDesc.descriptor) throw new Error('Missing API descriptor');
	switch (apiDesc.type) {
		case 'VK':
			if (!apiDesc.groupId) throw new Error('Missing vk groupId');
			if (typeof apiDesc.groupId !== 'number') throw new Error('VK groupId must be number');
			if (!apiDesc.tokens) throw new Error('Missing vk tokens');
			return new VKApi(apiDesc.descriptor, apiDesc.groupId, apiDesc.tokens);
		case 'DS':
			if (!apiDesc.token) throw new Error('Missing ds token');
			return new DiscordApi(apiDesc.descriptor, apiDesc.token);
		case 'TG':
			if (!apiDesc.token) throw new Error('Missing tg token');
			if (!apiDesc.username) throw new Error('missing username');
			return new TelegramApi(apiDesc.descriptor, apiDesc.username, apiDesc.token);
		default:
			throw new Error(`Unknown API type: ${apiDesc.type}`);
	}
}

(async () => {
	const apis: Api<any>[] = config.apis.map(parseApi);
	const ayzek = new Ayzek('ayzek', apis, '/', true);
	const ps = new ModernPluginSystem(ayzek,
		() => (require as any).context('./plugins', true, /Plugin\/index\.([jt]sx?|coffee)$/, 'lazy'),
		(acceptor, getContext) => {
			if ((module as any).hot) {
				(module as any).hot.accept(getContext().id, acceptor)
			}
		}
	);
	const pps = new ModernPluginSystem(ayzek,
		() => (require as any).context('./privatePlugins', true, /Plugin\/index\.([jt]sx?|coffee)$/, 'lazy'),
		(acceptor, getContext) => {
			if ((module as any).hot) {
				(module as any).hot.accept(getContext().id, acceptor);
			}
		})
	await Promise.all([pps.load({ ayzek }), ps.load({ ayzek }), ayzek.doWork()]);
})();
