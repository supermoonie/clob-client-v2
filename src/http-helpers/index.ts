/* eslint-disable max-depth */
import axios, { type Method, type RawAxiosRequestHeaders, type AxiosInstance } from "axios";
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

// Axios 单例实例
let axiosInstance: AxiosInstance | null = null;

// 设置全局代理
export const setGlobalProxy = (config: ProxyConfig | null): void => {
	globalProxyConfig = config;
	// 代理配置变更时重新创建实例
	resetAxiosInstance();
};

// 重置 axios 实例
const resetAxiosInstance = (): void => {
	// 销毁旧的 agent 连接池
	if (axiosInstance?.defaults.httpAgent) {
		(axiosInstance.defaults.httpAgent as any)?.destroy?.();
	}
	if (axiosInstance?.defaults.httpsAgent) {
		(axiosInstance.defaults.httpsAgent as any)?.destroy?.();
	}
	axiosInstance = null;
};

// 获取代理agent（单例缓存）
let cachedHttpAgent: HttpProxyAgent<any> | null = null;
let cachedHttpsAgent: HttpsProxyAgent<any> | null = null;
let cachedProxyUrl: string | null = null;

const clearProxyAgentCache = (): void => {
	if (cachedHttpAgent) {
		cachedHttpAgent.destroy?.();
		cachedHttpAgent = null;
	}
	if (cachedHttpsAgent) {
		cachedHttpsAgent.destroy?.();
		cachedHttpsAgent = null;
	}
	cachedProxyUrl = null;
};

const getProxyAgent = (url: string): any => {
	if (!globalProxyConfig || isBrowser) return undefined;

	const proxyUrl = globalProxyConfig.auth
		? `${globalProxyConfig.protocol || "http"}://${globalProxyConfig.auth.username}:${globalProxyConfig.auth.password}@${globalProxyConfig.host}:${globalProxyConfig.port}`
		: `${globalProxyConfig.protocol || "http"}://${globalProxyConfig.host}:${globalProxyConfig.port}`;

	const isHttps = url.startsWith("https");

	// 检查缓存是否有效
	if (cachedProxyUrl !== proxyUrl) {
		clearProxyAgentCache();
		cachedProxyUrl = proxyUrl;
	}

	const agentConfig = {
		keepAlive: true,
		keepAliveMsecs: 1000,
		maxSockets: 50,        // 降低以避免内存泄漏
		maxFreeSockets: 10,    // 保持较少的空闲连接
		scheduling: "lifo" as const,
		timeout: 60000,
	};

	if (isHttps) {
		if (!cachedHttpsAgent) {
			cachedHttpsAgent = new HttpsProxyAgent(proxyUrl, agentConfig);
			cachedHttpsAgent.setMaxListeners?.(20); // 增加监听器限制
		}
		return cachedHttpsAgent;
	} else {
		if (!cachedHttpAgent) {
			cachedHttpAgent = new HttpProxyAgent(proxyUrl, agentConfig);
			cachedHttpAgent.setMaxListeners?.(20);
		}
		return cachedHttpAgent;
	}
};

// 获取或创建 axios 单例实例
const getAxiosInstance = (proxyConfig?: ProxyConfig): AxiosInstance => {
	// 如果传入了临时的代理配置，创建临时实例（不复用单例）
	if (proxyConfig) {
		return createAxiosInstance(proxyConfig);
	}

	// 使用全局代理配置的单例
	if (!axiosInstance) {
		axiosInstance = createAxiosInstance(globalProxyConfig || undefined);
	}
	return axiosInstance;
};

// 创建 axios 实例
const createAxiosInstance = (proxyConfig?: ProxyConfig): AxiosInstance => {
	const activeProxy = proxyConfig || globalProxyConfig;
	const agent = activeProxy && !isBrowser ? getProxyAgent("https://") : undefined;

	const instance = axios.create({
		timeout: 30000,
		maxRedirects: 5,           // 限制重定向次数
		maxContentLength: 50 * 1024 * 1024, // 50MB
		httpAgent: agent,
		httpsAgent: agent,
	});

	// 设置监听器限制
	if (agent?.setMaxListeners) {
		agent.setMaxListeners(20);
	}

	// 添加请求拦截器
	instance.interceptors.request.use(
		(config) => {
			// 如果没有显式设置，为每个请求添加代理agent
			if (activeProxy && !isBrowser && !config.httpAgent && !config.httpsAgent) {
				const requestAgent = getProxyAgent(config.url || "https://");
				config.httpAgent = requestAgent;
				config.httpsAgent = requestAgent;
			}
			return config;
		},
		(error) => {
			return Promise.reject(error);
		}
	);

	return instance;
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
	proxyConfig?: ProxyConfig,
): Promise<any> => {
	overloadHeaders(method, headers);

	const instance = getAxiosInstance(proxyConfig);

	return await instance({
		method,
		url: endpoint,
		headers,
		data,
		params,
	});
};

export type QueryParams = Record<string, any>;

export interface RequestOptions {
	headers?: RawAxiosRequestHeaders;
	data?: any;
	params?: QueryParams;
	proxyConfig?: ProxyConfig;
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

// 清理资源的函数（在应用关闭时调用）
export const cleanup = (): void => {
	resetAxiosInstance();
	clearProxyAgentCache();
};