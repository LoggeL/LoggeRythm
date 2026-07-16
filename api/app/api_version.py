"""Version identifiers shared by the API and its checked-in contract."""

API_VERSION = "1.1.0"
OPENAPI_CONTRACT_VERSION = "v2"

# A server may advance its current contract while continuing to honor older
# clients. Android negotiates against this explicit set instead of guessing
# compatibility from a semantic API version.
# The server still exposes every v1 route/body unchanged. Android v2 requires
# the stable playlist-entry contract and therefore fails closed against a
# server that advertises only v1.
COMPATIBLE_OPENAPI_CONTRACT_VERSIONS = ("v1", OPENAPI_CONTRACT_VERSION)
