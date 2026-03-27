FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json /app/package.json
RUN npm install

COPY . /app

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
