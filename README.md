# OCAP Web component

## Configuration

The configuration file is called `setting.json`

**"listen"**: Listener for the web server, change to "0.0.0.0:5000" to listen on all interfaces
**"secret"**: Secret used for authenticate on record upload
**"logger"**: Enables request logging to STDOUT

## Docker

### Environment Variables

**OCAP_SECRET**

This specifies the secret that will be used to authorize record to be uploaded.

**OCAP_CUSTOMIZE_WEBSITEURL**

Link on the logo to your website

**OCAP_CUSTOMIZE_WEBSITELOGO**

URL to your website logo

**OCAP_CUSTOMIZE_WEBSITELOGOSIZE**

Size of the logo shown on the page, default 32px

### Volumes

**/var/lib/ocap/data**

This is the folder where all the records is being stored in a gzipped json format `json.gz`.

**/var/lib/ocap/maps**

All maps are stored here. Maps can be downloaded from [here](https://drive.google.com/drive/folders/1qtT0Fr4Dfwd48ihZNc8YN-xgxHchKoiu).

**/var/lib/ocap/db**

Database location stored in SQLite3 format.

### Start an OCAP webserver instance

```
docker run --name ocap-web -d \
  -p 5000:5000/tcp \
  -e OCAP_SECRET="same-secret"
  -v ocap-records:/var/lib/ocap/data \
  -v ocap-maps:/var/lib/ocap/maps \
  -v ocap-database:/var/lib/ocap/db \
  ghcr.io/ocap2/web:latest
```

## Build from source

This Project is based on [Golang](https://golang.org/dl/)

### Windows

```bash
go build -o ocap-webserver.exe ./cmd
```

### Linux

```
go build -o ocap-webserver ./cmd
```

### Docker

```
docker build -t ocap-webserver .
```
