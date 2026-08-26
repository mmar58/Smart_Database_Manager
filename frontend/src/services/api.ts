export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

export const api = {
    async get<T>(endpoint: string): Promise<T> {
        const res = await fetch(`/api${endpoint}`);
        if (!res.ok) {
            let msg = res.statusText;
            try { const err = await res.json(); msg = err.error || msg; } catch (e) {}
            throw new ApiError(res.status, msg);
        }
        return res.json();
    },

    async post<T>(endpoint: string, body: any): Promise<T> {
        const res = await fetch(`/api${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let msg = res.statusText;
            try { const err = await res.json(); msg = err.error || msg; } catch (e) {}
            throw new ApiError(res.status, msg);
        }
        return res.json();
    },

    async put<T>(endpoint: string, body: any): Promise<T> {
        const res = await fetch(`/api${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let msg = res.statusText;
            try { const err = await res.json(); msg = err.error || msg; } catch (e) {}
            throw new ApiError(res.status, msg);
        }
        return res.json();
    },

    async delete<T>(endpoint: string): Promise<T> {
        const res = await fetch(`/api${endpoint}`, { method: 'DELETE' });
        if (!res.ok) {
            let msg = res.statusText;
            try { const err = await res.json(); msg = err.error || msg; } catch (e) {}
            throw new ApiError(res.status, msg);
        }
        return res.json();
    }
};
