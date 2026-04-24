import { type Method, type RawAxiosRequestHeaders } from "axios";
import type { DropNotificationParams, OrdersScoringParams } from "../types/index.js";
export declare const GET = "GET";
export declare const POST = "POST";
export declare const DELETE = "DELETE";
export declare const PUT = "PUT";
export interface ProxyConfig {
    host: string;
    port: number;
    protocol?: "http" | "https";
    auth?: {
        username: string;
        password: string;
    };
}
export declare const setGlobalProxy: (config: ProxyConfig | null) => void;
export declare const request: (endpoint: string, method: Method, headers?: any, data?: any, params?: any, proxyConfig?: ProxyConfig) => Promise<any>;
export type QueryParams = Record<string, any>;
export interface RequestOptions {
    headers?: RawAxiosRequestHeaders;
    data?: any;
    params?: QueryParams;
    proxyConfig?: ProxyConfig;
}
export declare const post: (endpoint: string, options?: RequestOptions, retryOnError?: boolean) => Promise<any>;
export declare const get: (endpoint: string, options?: RequestOptions) => Promise<any>;
export declare const del: (endpoint: string, options?: RequestOptions) => Promise<any>;
export declare const parseOrdersScoringParams: (orderScoringParams?: OrdersScoringParams) => QueryParams;
export declare const parseDropNotificationParams: (dropNotificationParams?: DropNotificationParams) => QueryParams;
