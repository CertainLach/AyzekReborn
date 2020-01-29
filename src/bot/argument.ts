import { ArgumentType } from "../command/arguments";
import { ParseEntryPoint, CommandContext } from "../command/command";
import { UserDisplayableError } from "../command/error";
import StringReader from "../command/reader";
import { Api } from "../model/api";
import { User } from "../model/conversation";
import { MaybePromise } from "../api/promiseMap";
import { SuggestionsBuilder, Suggestions } from "../command/suggestions";
import { AyzekCommandContext } from "./plugin";
import { Ayzek } from "./ayzek";

// TODO: Type safety?
export class UserArgumentType extends ArgumentType<[Api<any>, any, Ayzek<any>], User<any>> {
	parse<P>(ctx: ParseEntryPoint<P>, reader: StringReader): [Api<any>, any, Ayzek<any>] {
		if (!(ctx.sourceProvider as unknown as Api<any>)?.apiLocalUserArgumentType) throw new Error(`sourceProvider is not ayzek one (${ctx.sourceProvider})`);
		const api = (ctx.sourceProvider as unknown as Api<any>);
		const user = api.apiLocalUserArgumentType.parse(ctx, reader);
		return [api, user, ctx.ayzek];
	}
	async load(parsed: [Api<any>, any, Ayzek<any>]): Promise<User<any>> {
		const user = await parsed[0].apiLocalUserArgumentType.load(parsed[1]);
		await parsed[2].attachToUser(user);
		return user;
	}
	getExamples<P>(ctx: ParseEntryPoint<P>) {
		if (!(ctx.sourceProvider as unknown as Api<any>)?.apiLocalUserArgumentType) throw new Error(`sourceProvider is not ayzek one (${ctx.sourceProvider})`);
		const api = (ctx.sourceProvider as unknown as Api<any>);
		return api.apiLocalUserArgumentType.getExamples(ctx);
	}
	async listSuggestions<P>(entry: ParseEntryPoint<P>, ctx: AyzekCommandContext, builder: SuggestionsBuilder): Promise<Suggestions> {
		if (!(ctx.source?.api as unknown as Api<any>)?.apiLocalUserArgumentType) throw new Error(`sourceProvider is not ayzek one (${ctx.source})`);
		const api = ctx.source.api as Api<any>;
		return api.apiLocalUserArgumentType.listSuggestions(entry, ctx, builder);
	}
}

export class NoSuchUserError extends UserDisplayableError {
	constructor(id: string, reader: StringReader) {
		super(`User not found: ${id}`, reader);
		this.name = 'NoSuchUserError';
	}
}

export function userArgument() {
	return new UserArgumentType();
}
