#!/bin/bash

# Example curl GET request
curl "http://localhost:3001/api/near/create_near_funding_account" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    && echo ""

# GET request with query parameters
curl -X GET "http://localhost:3001/api/nearcreate_near_holding_account" \
    -H "Accept: application/json"
