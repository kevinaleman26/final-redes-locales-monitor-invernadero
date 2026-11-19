from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://invernadero:invernadero@localhost:5432/invernadero"
    rabbitmq_url: str = "amqp://invernadero:invernadero@localhost:5672/"
    queue_name: str = "sensor.readings"
    worker_prefetch: int = 50
    cors_origins: str = "*"


settings = Settings()
