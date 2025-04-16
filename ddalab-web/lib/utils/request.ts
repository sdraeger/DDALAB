interface ApiRequestOptions {
	url: string; // Required
	token?: string; // Optional for endpoints that require authentication
	method?: string; // Optional, defaults to "GET"
	contentType?: string; // Optional, defaults to "application/json"
	body?: Record<string, any> | null; // Optional, can be any object or null
	headers?: Record<string, string>; // Optional, key-value pairs for headers
}

export async function apiRequest({
	url,
	token,
	method = "GET",
	contentType = "application/json",
	body = null,
	headers = {},
}: ApiRequestOptions): Promise<Response> {
	const defaultHeaders: Record<string, string> = {
		...(token && { Authorization: `Bearer ${token}` }),
		...(body && { "Content-Type": contentType }),
		...headers,
	};

	const config: RequestInit = {
		method,
		headers: defaultHeaders,
		...(body && { body: contentType === "application/json" ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>) }),
	};

	const fullUrl = url;

	const response = await fetch(fullUrl, config);
	return response;
}
