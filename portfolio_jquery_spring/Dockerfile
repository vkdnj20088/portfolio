# guard(Spring Boot) 컨테이너 - k8s 실험용.
#
# 빌드:  ./gradlew bootJar && docker build -t portfolio/guard:dev .
# 실행:  docker run --rm -p 8080:8080 portfolio/guard:dev   (기본 프로파일 = H2 인메모리)
#
# jar 를 이미지 안에서 빌드하지 않고 **밖에서 빌드해 넣는다**. 안에서 빌드하면 Gradle 배포판과
# 의존성을 매번 새로 받아 반복 주기가 느려지고, CI 는 이미 러너의 Gradle 캐시로 jar 를 만든다 -
# 같은 산출물을 두 번 만들 이유가 없다. 대신 "이미지가 어떤 커밋의 jar 인지"는 빌드 인자로 박는다.
FROM eclipse-temurin:21-jre-jammy

ARG JAR_FILE=build/libs/*.jar
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA

WORKDIR /app

# 비루트 실행 - 파일 업로드를 받는 서비스라 프로세스 권한을 낮춰 둔다(loandoc 과 같은 이유).
RUN useradd --create-home --uid 10001 guard
COPY ${JAR_FILE} /app/app.jar
RUN chown guard:guard /app/app.jar
USER guard

EXPOSE 8080

# JVM 이 컨테이너 메모리 상한을 스스로 읽게 둔다(-XX:MaxRAMPercentage). 고정 -Xmx 로 박으면
# limits 를 바꿀 때마다 이미지를 다시 만들어야 하고, 그러면 limits 가 실제 상한이 아니게 된다.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar"]
