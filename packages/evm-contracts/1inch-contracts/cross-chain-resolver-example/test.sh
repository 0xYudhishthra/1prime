# Get the bytecode
BYTECODE=$(forge inspect Resolver bytecode)

# Get encoded constructor parameters
CONSTRUCTOR_PARAMS=$(cast abi-encode "constructor(address,address,address)" 0x1234567890123456789012345678901234567890 0x0987654321098765432109876543210987654321 0x1111111111111111111111111111111111111111)

# Remove 0x prefix from constructor params
CONSTRUCTOR_PARAMS_CLEAN=${CONSTRUCTOR_PARAMS#0x}

# Combine them
DEPLOYMENT_DATA="${BYTECODE}${CONSTRUCTOR_PARAMS_CLEAN}"

echo "$DEPLOYMENT_DATA" > deployment_data.txt