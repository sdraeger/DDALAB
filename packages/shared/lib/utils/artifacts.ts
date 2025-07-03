import { apiRequest } from "./request";
import type { Artifact } from "shared/store/slices/artifactsSlice";

export const fetchArtifactById = async (
  artifactId: string,
  token: string
): Promise<Artifact> => {
  const response = await apiRequest({
    url: `/api/artifacts/${artifactId}`,
    method: "GET",
    token: token,
    responseType: "response",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch artifact");
  }

  const data: Artifact = await response.json();
  return data;
};
