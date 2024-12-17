FROM python:3.11
EXPOSE 80
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY . ./
ENTRYPOINT [ "streamlit", "run", "app.py", "--server.port=80", "--server.address=0.0.0.0" ]