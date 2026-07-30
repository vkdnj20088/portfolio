package com.portfolio.extension.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * OpenAPI 스펙 스냅샷 게이트(#X3).
 *
 * <h2>왜 필요한가</h2>
 * springdoc 이 붙어 있다는 것과 <b>계약이 사고로 바뀌지 않는다</b>는 것은 다른 이야기다.
 * 지금까지 컨트롤러 시그니처를 고치면 문서는 자동으로 따라왔지만, 그 변화가 의도한 것인지
 * 아무도 확인하지 않았다. 이 테스트는 스펙을 커밋된 스냅샷과 비교해 <b>차이 자체를 실패로</b>
 * 만든다. 의도한 변경이면 스냅샷을 갱신해서 커밋하고, 그 diff 가 곧 "계약이 이렇게 바뀐다"는
 * 리뷰 대상이 된다. 문서를 만드는 단계에서 계약을 지키는 단계로 한 칸 올라간다.
 *
 * <h2>비결정성 제거</h2>
 * 스펙 JSON 을 그대로 비교하면 실행마다 달라지는 부분에서 헛실패가 난다. 두 가지를 정규화한다.
 * <ul>
 *   <li><b>키 순서</b> - 스캔 순서에 따라 객체 키 순서가 흔들릴 수 있어 모든 객체 키를 사전순으로
 *       재배열한다. 배열은 순서가 의미를 갖는 경우가 있어(예: enum 값, 파라미터 순서) 건드리지 않는다.</li>
 *   <li><b>servers</b> - 실행 환경에 따라 호스트/포트가 달라진다. 배포 주소는 계약이 아니라
 *       환경이므로 비교 대상에서 뺀다.</li>
 * </ul>
 *
 * <h2>갱신 방법</h2>
 * <pre>./gradlew test --tests '*OpenApiSnapshotTest*' -Dopenapi.snapshot.update=true</pre>
 * 실패 시에도 실제 스펙을 {@code build/openapi-actual.json} 에 남기므로 diff 를 바로 볼 수 있다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiSnapshotTest {

    /** 커밋된 스냅샷. 테스트 리소스에 두어 산출물이 아니라 소스로 관리한다. */
    private static final Path SNAPSHOT =
            Path.of("src", "test", "resources", "openapi-snapshot.json");
    /** 불일치 시 실제 스펙을 남기는 위치(빌드 산출물). */
    private static final Path ACTUAL = Path.of("build", "openapi-actual.json");
    private static final String UPDATE_FLAG = "openapi.snapshot.update";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 실제 소켓을 열지 않고 MVC 스택으로 호출한다 - 스펙 생성은 서블릿 컨테이너가 아니라
     * springdoc 의 핸들러가 하는 일이므로 랜덤 포트를 띄울 이유가 없다(테스트가 더 빠르고,
     * 포트 충돌 같은 환경 실패도 사라진다).
     */
    @Autowired
    private MockMvc mvc;

    @Test
    @DisplayName("OpenAPI 스펙이 커밋된 스냅샷과 같다 - 계약 변경은 스냅샷 갱신으로 드러난다")
    void openApiSpecMatchesSnapshot() throws Exception {
        String body = mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString(StandardCharsets.UTF_8);
        assertThat(body)
                .as("springdoc 이 스펙을 내주지 않았다(기본 프로파일에서 api-docs 가 켜져 있어야 한다)")
                .isNotBlank();

        String actual = pretty(normalize(MAPPER.readTree(body)));

        if (Boolean.getBoolean(UPDATE_FLAG)) {
            Files.createDirectories(SNAPSHOT.getParent());
            Files.writeString(SNAPSHOT, actual, StandardCharsets.UTF_8);
            // 갱신 모드는 통과시키지 않는다: 갱신하면서 통과까지 하면 CI 에 -D 를 켠 채로 두었을 때
            // 게이트가 조용히 무력화된다(항상 최신 스펙을 스냅샷으로 덮어쓰므로 늘 통과한다).
            fail("스냅샷을 갱신했습니다: " + SNAPSHOT.toAbsolutePath()
                    + " - 내용을 확인하고 커밋한 뒤 -D" + UPDATE_FLAG + " 없이 다시 실행하세요.");
        }

        if (!Files.exists(SNAPSHOT)) {
            writeActual(actual);
            fail("스냅샷이 없습니다. -D" + UPDATE_FLAG + "=true 로 한 번 생성하고 커밋하세요.");
        }

        String expected = Files.readString(SNAPSHOT, StandardCharsets.UTF_8);
        if (!expected.equals(actual)) {
            writeActual(actual);
            fail("""
                    OpenAPI 계약이 스냅샷과 다릅니다.

                      기대: %s
                      실제: %s

                    의도한 변경이면 아래로 갱신하고 그 diff 를 리뷰에 포함하세요.
                      ./gradlew test --tests '*OpenApiSnapshotTest*' -D%s=true
                    """.formatted(SNAPSHOT.toAbsolutePath(), ACTUAL.toAbsolutePath(), UPDATE_FLAG));
        }
    }

    private static void writeActual(String actual) throws IOException {
        Files.createDirectories(ACTUAL.getParent());
        Files.writeString(ACTUAL, actual, StandardCharsets.UTF_8);
    }

    /**
     * 비교 가능한 형태로 정규화한다. 객체 키는 사전순으로 재배열하고, 환경에 따라 달라지는
     * 최상위 {@code servers} 는 제거한다. 배열 순서는 의미를 가질 수 있어 보존한다.
     */
    private static JsonNode normalize(JsonNode node) {
        if (node.isObject()) {
            ObjectNode src = (ObjectNode) node;
            List<String> keys = new ArrayList<>();
            src.fieldNames().forEachRemaining(keys::add);
            keys.remove("servers"); // 랜덤 포트 - 계약이 아니라 환경
            keys.sort(String::compareTo);
            ObjectNode out = MAPPER.createObjectNode();
            for (String key : keys) {
                out.set(key, normalize(src.get(key)));
            }
            return out;
        }
        if (node.isArray()) {
            ArrayNode out = MAPPER.createArrayNode();
            for (JsonNode child : node) {
                out.add(normalize(child));
            }
            return out;
        }
        return node;
    }

    /** 줄 단위 diff 가 읽히도록 들여쓴다 + 개행으로 끝낸다(에디터/깃 관례). */
    private static String pretty(JsonNode node) throws IOException {
        return MAPPER.writerWithDefaultPrettyPrinter().writeValueAsString(node) + "\n";
    }
}
