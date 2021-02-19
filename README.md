# Maana Q Export Import Assistant

An assistant to use with the Maana Q platform to export the information from a
Workspace, and then import it into another workspace.  This can be done across
different deployment of the platform as long as both clusters have all the
dependent services added with the same IDs.


## Deployment:

We've included a Docker file that you can use to containerize your Assistant and
deploy it using the [Maana CLI](https://github.com/maana-io/q-cli) command
`mdeploy`.

When deploying the Export Import Assistant you need to set the environment
variable `LAMBDA_SERVICE_ID` to be the ID of the Maana Lambda Service on the
clusters it will be working on.  The default ID used by the container is
`io.maana.lambda-server`.

## Development

As with any Node application, you must first install dependencies:

```
npm i
```

### Dev/Debug Build

```bash
# Start watch mode (watches for changes and recompiles; fast)
npm run watch

# Start local server (default port is 3000)
npm run serve

# Start tunnel service (default port is 3000)
# this will give you a URL to plug into the Endpoint URL field in Q
# see "Tunneling" below for more information
npm run tunnel
```

### Production Build

To test in `production` mode you can either:

1. Build once and serve assets

    ```bash
    # build once (defaults to prod build)
    npm run build

    # start server
    npm run serve

    # start tunnel service
    # see "Tunneling" below for more information
    npm run tunnel
    ```

1. OR you can run the watch mode with the production flag

    ```bash
    # start watcher
    npm run watch:prod

    # serve assets
    npm run serve

    # start tunnel service
    # see "Tunneling" below for more information
    npm run tunnel
    ```

## Docker

```bash
# build image
docker build -t my-lambda-image .

# run image, binding the image's port 80 to your local machine's port 8080
docker run -it -p 8080:80 my-lambda-image

# start tunnel service to port 80
PORT=8080 npm run tunnel
```

## Tunneling

It is typical to debug locally by using [localtunnel](https://localtunnel.github.io/www/) or similar (such as [ngrok](https://ngrok.com/)).

Simply configure `localtunnel` or `ngrok` to expose your service to the web and register it with your instance of Q (see
[Registering a Custom Service](https://maana.gitbook.io/q/v/3.2.1/maana-q-cookbook/basic-ingredients/11-publish-knowledge-services)).
