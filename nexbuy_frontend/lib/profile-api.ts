import { getApiBaseUrl, readAccessToken } from "@/lib/auth";

export type UserAddressPayload = {
  recipient_name: string | null;
  phone_number: string | null;
  country: string | null;
  province_state: string | null;
  city: string | null;
  district: string | null;
  street_line_1: string | null;
  street_line_2: string | null;
  postal_code: string | null;
  delivery_notes: string | null;
  is_default: boolean;
};

export type UserAddress = UserAddressPayload & {
  id: string;
};

export type UserAddressListResponse = {
  addresses: UserAddress[];
};

function buildAuthHeaders() {
  const token = readAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? ((await response.json()) as unknown) : null;

  if (!response.ok) {
    if (payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string") {
      throw new Error(payload.detail);
    }
    throw new Error(fallbackMessage);
  }

  return (payload ?? {}) as T;
}

export async function fetchUserAddresses(): Promise<UserAddressListResponse> {
  const response = await fetch(`${getApiBaseUrl()}/profile/addresses`, {
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<UserAddressListResponse>(response, "Could not load address information.");
}

export async function createUserAddress(payload: UserAddressPayload): Promise<UserAddressListResponse> {
  const response = await fetch(`${getApiBaseUrl()}/profile/addresses`, {
    method: "POST",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<UserAddressListResponse>(response, "Could not create address.");
}

export async function updateUserAddress(addressId: string, payload: UserAddressPayload): Promise<UserAddressListResponse> {
  const response = await fetch(`${getApiBaseUrl()}/profile/addresses/${addressId}`, {
    method: "PUT",
    headers: buildAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse<UserAddressListResponse>(response, "Could not update address.");
}

export async function setDefaultUserAddress(addressId: string): Promise<UserAddressListResponse> {
  const response = await fetch(`${getApiBaseUrl()}/profile/addresses/${addressId}/default`, {
    method: "POST",
    headers: buildAuthHeaders(),
  });
  return parseJsonResponse<UserAddressListResponse>(response, "Could not update default address.");
}
