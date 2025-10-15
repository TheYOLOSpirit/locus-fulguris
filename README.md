##### locus-fulguris #####

# 1. Run this command to create the production .env and edit the values to your requirements.
cp .env.example .env

# 2. Start the server with this command
docker compose up --build --force-recreate -d

# To debug LND connection, use env variables:
# GRPC_VERBOSITY=DEBUG
# GRPC_TRACE=all

## Acknowledgements
This project was inspired by the work on [Lightning Address Server](https://github.com/mefatbear/lightning-address-nodejs) by [@MeFatBear]. We are deeply grateful for their contribution to the open-source community.