/* eslint-disable max-depth */
import axios, { type Method, type RawAxiosRequestHeaders } from "axios";
import { isBrowser } from "browser-or-node";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

import type { DropNotificationParams, OrdersScoringParams } from "../types/index.js";

export const GET = "GET";
export const POST = "POST";
export const DELETE = "DELETE";
export const PUT = "PUT";

// 代理配置接口
export interface ProxyConfig {
	host: string;
	port: number;
	protocol?: "http" | "https";
	auth?: {
		username: string;
		password: string;
	};
}

// 全局代理配置
let globalProxyConfig: ProxyConfig | null = null;

// 设置全局代理
export const setGlobalProxy = (config: ProxyConfig | null): void => {
	globalProxyConfig = config;
};

// 获取代理agent
const getProxyAgent = (url: string): any => {
	if (!globalProxyConfig || isBrowser) return undefined;

	const proxyUrl = globalProxyConfig.auth
		? `${globalProxyConfig.protocol || "http"}://${globalProxyConfig.auth.username}:${globalProxyConfig.auth.password}@${globalProxyConfig.host}:${globalProxyConfig.port}`
		: `${globalProxyConfig.protocol || "http"}://${globalProxyConfig.host}:${globalProxyConfig.port}`;

	const isHttps = url.startsWith("https");

	if (isHttps) {
		return new HttpsProxyAgent(proxyUrl, {
			keepAlive: true,
			maxSockets: 256,
			maxFreeSockets: 32,
		});
	} else {
		return new HttpProxyAgent(proxyUrl, {
			keepAlive: true,
			maxSockets: 256,
			maxFreeSockets: 32,
		});
	}
};

const overloadHeaders = (
	method: Method,
	headers: Record<string, string | number | boolean> = {},
) => {
	if (isBrowser) {
		return;
	}

	headers["User-Agent"] = `@polymarket/clob-client`;
	headers.Accept = "*/*";
	headers.Connection = "keep-alive";
	headers["Content-Type"] = "application/json";

	if (method === GET) {
		headers["Accept-Encoding"] = "gzip";
	}
};

export const request = async (
	endpoint: string,
	method: Method,
	headers?: any,
	data?: any,
	params?: any,
	proxyConfig?: ProxyConfig, // 添加可选参数支持临时代理
): Promise<any> => {
	overloadHeaders(method, headers);

	// 优先使用传入的代理配置，否则使用全局代理配置
	const activeProxy = proxyConfig || globalProxyConfig;
	const agent = activeProxy ? getProxyAgent(endpoint) : undefined;

	return await axios({
		method,
		url: endpoint,
		headers,
		data,
		params,
		httpAgent: agent,
		httpsAgent: agent,
	});
};

export type QueryParams = Record<string, any>;

export interface RequestOptions {
	headers?: RawAxiosRequestHeaders;
	data?: any;
	params?: QueryParams;
	proxyConfig?: ProxyConfig; // 添加代理配置到请求选项中
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export const post = async (
	endpoint: string,
	options?: RequestOptions,
	retryOnError: boolean = false,
): Promise<any> => {
	try {
		const resp = await request(
			endpoint,
			POST,
			options?.headers,
			options?.data,
			options?.params,
			options?.proxyConfig,
		);
		return resp.data;
	} catch (err: unknown) {
		if (retryOnError && isTransientAxiosError(err)) {
			console.log("[CLOB Client-v2] transient error, retrying once after 30 ms");
			await sleep(30);
			try {
				const resp = await request(
					endpoint,
					POST,
					options?.headers,
					options?.data,
					options?.params,
					options?.proxyConfig,
				);
				return resp.data;
			} catch (retryErr: unknown) {
				return errorHandling(retryErr);
			}
		}
		return errorHandling(err);
	}
};

export const get = async (endpoint: string, options?: RequestOptions): Promise<any> => {
	try {
		const resp = await request(
			endpoint,
			GET,
			options?.headers,
			options?.data,
			options?.params,
			options?.proxyConfig,
		);
		return resp.data;
	} catch (err: unknown) {
		return errorHandling(err);
	}
};

export const del = async (endpoint: string, options?: RequestOptions): Promise<any> => {
	try {
		const resp = await request(
			endpoint,
			DELETE,
			options?.headers,
			options?.data,
			options?.params,
			options?.proxyConfig,
		);
		return resp.data;
	} catch (err: unknown) {
		return errorHandling(err);
	}
};

const errorHandling = (err: unknown) => {
	if (axios.isAxiosError(err)) {
		if (err.response) {
			console.error(
				"[CLOB Client] request error",
				JSON.stringify({
					status: err.response?.status,
					statusText: err.response?.statusText,
					data: err.response?.data,
					config: err.response?.config,
				}),
			);
			if (err.response?.data) {
				if (
					typeof err.response?.data === "string" ||
					err.response?.data instanceof String
				) {
					return { error: err.response?.data, status: err.response?.status };
				}
				// biome-ignore lint/suspicious/noPrototypeBuiltins: ES2022 Object.hasOwn not available with current target
				if (!Object.prototype.hasOwnProperty.call(err.response?.data, "error")) {
					return { error: err.response?.data, status: err.response?.status };
				}
				// in this case the field 'error' is included
				return { ...err.response?.data, status: err.response?.status };
			}
		}

		if (err.message) {
			console.error(
				"[CLOB Client] request error",
				JSON.stringify({
					error: err.message,
				}),
			);
			return { error: err.message };
		}
	}

	console.error("[CLOB Client] request error", err);
	return { error: err };
};

const isTransientAxiosError = (err: unknown): boolean => {
	if (!axios.isAxiosError(err)) return false;
	if (!err.response) return true; // network error
	const status = err.response.status ?? 0;
	if (status >= 500 && status < 600) return true; // 5xx
	const code = (err.code ?? "").toString();
	return ["ECONNABORTED", "ENETUNREACH", "EAI_AGAIN", "ETIMEDOUT"].includes(code);
};

export const parseOrdersScoringParams = (orderScoringParams?: OrdersScoringParams): QueryParams => {
	const params: QueryParams = {};
	if (orderScoringParams !== undefined) {
		if (orderScoringParams.orderIds !== undefined) {
			params.order_ids = orderScoringParams?.orderIds.join(",");
		}
	}
	return params;
};

export const parseDropNotificationParams = (
	dropNotificationParams?: DropNotificationParams,
): QueryParams => {
	const params: QueryParams = {};
	if (dropNotificationParams !== undefined) {
		if (dropNotificationParams.ids !== undefined) {
			params.ids = dropNotificationParams?.ids.join(",");
		}
	}
	return params;
};
