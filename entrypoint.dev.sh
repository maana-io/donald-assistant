#!/bin/sh

PORT=7000
LAMBDA_SERVICE_ID=io.maana.lambda-server
NODE_ENV=development

echo "var MAANA_ENV = {"                          >  build/maana.env.js
echo "  LAMBDA_SERVICE_ID: '$LAMBDA_SERVICE_ID'," >> build/maana.env.js
echo "}"                                          >> build/maana.env.js

serve -c ./serve.json -s build -p $PORT
