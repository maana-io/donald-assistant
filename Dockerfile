# base image
FROM node:12.2.0-alpine

# set working directory
WORKDIR /usr/app

# add `/app/node_modules/.bin` to $PATH
ENV PATH /usr/app/node_modules/.bin:$PATH

COPY package* /usr/app/

# install dependencies before copying the rest of the code
# code is more likely to change than dependencies; this is an optimization of the docker layers
RUN npm install --silent

# copy application files
COPY public /usr/app/public
COPY src /usr/app/src
COPY entrypoint.sh /usr/app/

RUN npm run build

ENV PORT=80 \
  LAMBDA_SERVICE_ID='io.maana.lambda-server'

RUN chmod a+w /usr/app/build/maana.env.js

EXPOSE 80
CMD [ "sh", "-c", "/usr/app/entrypoint.sh" ]
