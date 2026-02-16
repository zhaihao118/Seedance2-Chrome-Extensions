// mention-main-world.js
// 运行在 MAIN world (页面 JS 上下文) — 直接访问 ProseMirror/TipTap API
// 由 manifest.json 注册，与 content.js 通过 window.postMessage 通信

(function() {
  'use strict';

  var LOG_PREFIX = '[Seedance-PM]';

  function log() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  function warn() {
    var args = [LOG_PREFIX];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.warn.apply(console, args);
  }

  // 监听来自 content script (ISOLATED world) 的消息
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) return;

    if (e.data.type === 'seedance-build-mention-doc') {
      var segments = e.data.segments;
      var eventName = e.data.eventName;
      log('收到 mention 构建请求, segments=' + segments.length + ', eventName=' + eventName);
      buildMentionDoc(segments, eventName);
    }

    if (e.data.type === 'seedance-upload-files') {
      var filesData = e.data.filesData; // [{base64, name, mimeType}]
      var eventName = e.data.eventName;
      log('收到文件上传请求, files=' + filesData.length + ', eventName=' + eventName);
      handleFileUpload(filesData, eventName);
    }

    // ===== 原生下载: hover 卡片 → 点击 button-group-top 中的下载按钮 =====
    if (e.data.type === 'seedance-click-download') {
      var selector = e.data.selector; // record 的选择器
      var eventName = e.data.eventName;
      log('收到原生下载请求, selector=' + selector);
      handleNativeDownload(selector, eventName);
    }

    // ===== 提升分辨率: hover 卡片 → 点击 button-group-bottom 中的提升分辨率按钮 =====
    if (e.data.type === 'seedance-click-upscale') {
      var selector = e.data.selector;
      var eventName = e.data.eventName;
      log('收到提升分辨率请求, selector=' + selector);
      handleUpscaleClick(selector, eventName);
    }
  });

  function findEditor() {
    var eds = document.querySelectorAll('[contenteditable="true"]');
    for (var i = 0; i < eds.length; i++) {
      var e = eds[i];
      if (e.closest && e.closest('[class*="sizer"]')) continue;
      if (e.closest && e.closest('#seedance-drawer-container')) continue;
      if (e.getBoundingClientRect().width > 50) return e;
    }
    return null;
  }

  function findPMView(el) {
    while (el) {
      if (el.pmViewDesc && el.pmViewDesc.view) return el.pmViewDesc.view;
      var ks = Object.getOwnPropertyNames(el);
      for (var i = 0; i < ks.length; i++) {
        try {
          var v = el[ks[i]];
          if (v && v.state && v.dispatch) return v;
          if (v && v.view && v.view.state) return v.view;
        } catch (ex) {}
      }
      el = el.parentElement;
    }
    // 全局 fallback
    var allEls = document.querySelectorAll('[contenteditable="true"]');
    for (var i = 0; i < allEls.length; i++) {
      if (allEls[i].pmViewDesc && allEls[i].pmViewDesc.view) return allEls[i].pmViewDesc.view;
    }
    return null;
  }

  function emitResult(eventName, detail) {
    window.postMessage({ type: eventName, detail: detail }, '*');
  }

  function buildMentionDoc(segments, eventName) {
    // Step 1: 找编辑器和 PM View
    var ed = findEditor();
    if (!ed) {
      warn('未找到编辑器');
      emitResult(eventName, { success: false, error: 'no editor' });
      return;
    }
    log('找到编辑器:', ed.tagName, ed.className.substring(0, 60));

    var view = findPMView(ed);
    if (!view) {
      warn('未找到 PM View');
      emitResult(eventName, { success: false, error: 'no PM view' });
      return;
    }
    log('找到 PM View');

    var schema = view.state.schema;
    var mentionType = schema.nodes['reference-mention-tag'];
    if (!mentionType) {
      warn('未找到 mention 节点类型, nodes:', Object.keys(schema.nodes).join(','));
      emitResult(eventName, { success: false, error: 'no mention type' });
      return;
    }
    log('找到 mention 节点类型: reference-mention-tag');

    // Step 2: 清空编辑器
    try {
      var sz = view.state.doc.content.size;
      if (sz > 2) {
        var emptyPara = schema.nodes.paragraph.create();
        view.dispatch(view.state.tr.replaceWith(0, sz, emptyPara));
      }
    } catch (e) { warn('clearEditor error:', e.message); }
    ed.focus();

    // Step 3: 通过 @ 弹窗读取 UUID
    // 必须用 execCommand / InputEvent 触发真实 DOM 输入
    // 因为 TipTap Suggestion 插件 hook 在 handleTextInput 上
    // 而 view.dispatch(tr.insertText) 不会触发 handleTextInput
    var atInserted = false;

    // 方法1: execCommand — 触发真实 DOM 输入 → PM handleTextInput → Suggestion
    try {
      atInserted = document.execCommand('insertText', false, '@');
      if (atInserted) {
        log('已通过 execCommand 输入 @，等待弹窗...');
      }
    } catch (e) {
      warn('execCommand 失败:', e.message);
    }

    // 方法2: InputEvent (现代浏览器的 beforeinput)
    if (!atInserted) {
      try {
        var biev = new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: '@',
          bubbles: true,
          cancelable: true,
          composed: true
        });
        ed.dispatchEvent(biev);
        var iev = new InputEvent('input', {
          inputType: 'insertText',
          data: '@',
          bubbles: true,
          composed: true
        });
        ed.dispatchEvent(iev);
        atInserted = true;
        log('已通过 InputEvent 输入 @，等待弹窗...');
      } catch (e2) {
        warn('InputEvent 失败:', e2.message);
      }
    }

    // 方法3: 模拟键盘事件
    if (!atInserted) {
      try {
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: '@', code: 'Digit2', shiftKey: true, bubbles: true }));
        ed.dispatchEvent(new KeyboardEvent('keypress', { key: '@', code: 'Digit2', shiftKey: true, bubbles: true }));
        document.execCommand('insertText', false, '@');
        ed.dispatchEvent(new KeyboardEvent('keyup', { key: '@', code: 'Digit2', shiftKey: true, bubbles: true }));
        atInserted = true;
        log('已通过键盘事件模拟输入 @，等待弹窗...');
      } catch (e3) {
        warn('键盘模拟失败:', e3.message);
      }
    }

    // 方法4: PM API (最后手段 — 不会触发 Suggestion 但能写入)
    if (!atInserted) {
      try {
        var tr = view.state.tr.insertText('@', view.state.selection.from);
        view.dispatch(tr);
        log('已通过 PM API 输入 @ (可能不触发弹窗)');
      } catch (e4) {
        warn('PM insertText @ 也失败:', e4.message);
      }
    }

    // Step 4: 轮询弹窗 (增加轮询次数和诊断)
    var attempts = 0;
    var MAX_ATTEMPTS = 30; // 30 * 300ms = 9s

    function findMentionPopup() {
      // 策略1: role="listbox" 含 图片/视频/参考/引用/Reference
      var listboxes = document.querySelectorAll('[role="listbox"]');
      for (var i = 0; i < listboxes.length; i++) {
        var t = listboxes[i].textContent || '';
        if (t.indexOf('图片') >= 0 || t.indexOf('视频') >= 0 ||
            t.indexOf('参考') >= 0 || t.indexOf('引用') >= 0 ||
            /reference|image|video/i.test(t)) {
          var opts = listboxes[i].querySelectorAll('[role="option"], li.lv-select-option, [class*="option"]');
          if (opts.length > 0) return { el: listboxes[i], opts: opts };
        }
      }
      // 策略2: 任何刚出现的 role="listbox" (不限定文本)
      for (var i = 0; i < listboxes.length; i++) {
        var opts = listboxes[i].querySelectorAll('[role="option"], li.lv-select-option, [class*="option"]');
        if (opts.length > 0) {
          var rect = listboxes[i].getBoundingClientRect();
          if (rect.width > 50 && rect.height > 20) {
            return { el: listboxes[i], opts: opts };
          }
        }
      }
      // 策略3: class 含 mention/suggestion/dropdown 的弹出层
      var popups = document.querySelectorAll('[class*="mention"], [class*="suggestion"], [class*="tippy"], [class*="dropdown"]');
      for (var i = 0; i < popups.length; i++) {
        var opts = popups[i].querySelectorAll('[role="option"], li, [class*="option"], [class*="item"]');
        if (opts.length > 0) {
          var rect = popups[i].getBoundingClientRect();
          if (rect.width > 50 && rect.height > 20) {
            return { el: popups[i], opts: opts };
          }
        }
      }
      return null;
    }

    function pollAndBuild() {
      attempts++;
      var found = findMentionPopup();

      if (found) {
        var popup = found.el;
        log('找到 @ 弹窗 (第' + attempts + '次), 开始读取 UUID...');
        // 读取 UUID
        var opts = found.opts;
        var ids = [];
        for (var oi = 0; oi < opts.length; oi++) {
          var opt = opts[oi];
          var label = (opt.textContent || '').trim();
          var uuid = null;
          // 尝试从 React Fiber 读取 UUID
          var fk = Object.keys(opt).find(function(k) {
            return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
          });
          if (fk) {
            var f = opt[fk];
            for (var fi = 0; fi < 15 && f; fi++) {
              var p = f.memoizedProps || f.pendingProps;
              if (p) {
                // 直接 value 字段
                if (p.value && typeof p.value === 'string' && p.value.length > 20) {
                  uuid = p.value; break;
                }
                // data-value 属性
                if (p['data-value'] && typeof p['data-value'] === 'string' && p['data-value'].length > 20) {
                  uuid = p['data-value']; break;
                }
                // id 字段 (可能在子组件中)
                if (p.id && typeof p.id === 'string' && p.id.length > 20) {
                  uuid = p.id; break;
                }
                // item.id 或 item.uuid
                if (p.item) {
                  if (p.item.id && typeof p.item.id === 'string') { uuid = p.item.id; break; }
                  if (p.item.uuid && typeof p.item.uuid === 'string') { uuid = p.item.uuid; break; }
                }
              }
              f = f.return;
            }
          }
          // 也尝试 DOM data-* 属性
          if (!uuid) {
            uuid = opt.getAttribute('data-value') || opt.getAttribute('data-id') || null;
          }
          ids.push({ label: label, id: uuid, index: oi });
          log('引用[' + oi + '] "' + label + '" → ' + (uuid || '未知'));
        }

        // 关闭弹窗
        ed.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', keyCode: 27, code: 'Escape', bubbles: true, cancelable: true
        }));
        ed.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Escape', keyCode: 27, code: 'Escape', bubbles: true
        }));

        setTimeout(function() {
          // 确保弹窗关闭
          var stillVisible = findMentionPopup();
          if (stillVisible) {
            document.body.click();
            log('弹窗仍可见，点击 body 关闭');
          }
          // 清空编辑器后构建
          try {
            view = findPMView(ed);
            if (view) {
              var sz2 = view.state.doc.content.size;
              if (sz2 > 2) {
                view.dispatch(view.state.tr.replaceWith(0, sz2, schema.nodes.paragraph.create()));
              }
            }
          } catch (e) { warn('清空编辑器失败:', e.message); }
          setTimeout(function() { finishBuild(ids); }, 200);
        }, 300);
      } else if (attempts < MAX_ATTEMPTS) {
        if (attempts % 5 === 0) {
          log('等待弹窗... (第' + attempts + '/' + MAX_ATTEMPTS + '次尝试)');
          // 每10次尝试，再次输入 @ (可能前一次被吞掉)
          if (attempts % 10 === 0) {
            log('重新输入 @ 触发弹窗...');
            try {
              // 先清空编辑器
              view = findPMView(ed);
              if (view) {
                var sz3 = view.state.doc.content.size;
                if (sz3 > 2) {
                  view.dispatch(view.state.tr.replaceWith(0, sz3, schema.nodes.paragraph.create()));
                }
              }
              ed.focus();
              document.execCommand('insertText', false, '@');
            } catch (re) { warn('重新输入 @ 失败:', re.message); }
          }
        }
        setTimeout(pollAndBuild, 300);
      } else {
        warn('@ 弹窗未出现 (' + MAX_ATTEMPTS + '次尝试)，直接构建文档 (无 UUID)');
        // 清空 @ 字符
        try {
          view = findPMView(ed);
          if (view) {
            var sz2 = view.state.doc.content.size;
            if (sz2 > 2) {
              view.dispatch(view.state.tr.replaceWith(0, sz2, schema.nodes.paragraph.create()));
            }
          }
        } catch (e) {}
        finishBuild(null);
      }
    }

    function finishBuild(ids) {
      // ----------------------------------------------------------------
      // 按 label (图片N/视频N) 匹配弹窗选项, 获取 UUID
      // segments[].label = "图片1" / "视频1" (由 content.js 根据文件名映射得到)
      // ids[].label = 弹窗选项文本, 如 "[图片1] xxx.jpg" 或 "图片1"
      // ----------------------------------------------------------------
      if (ids && ids.length > 0) {
        // 先建立 弹窗label 中包含的 "图片N/视频N" → UUID 的映射
        var labelToUUID = {};
        for (var ii = 0; ii < ids.length; ii++) {
          var popupText = ids[ii].label || '';
          var uuid = ids[ii].id;
          if (!uuid) continue;

          // 从弹窗文本中提取 "图片N" 或 "视频N"
          var m = popupText.match(/(图片|视频)\d+/);
          if (m) {
            labelToUUID[m[0]] = uuid;
            log('弹窗选项: "' + popupText.substring(0, 40) + '" → 标签 "' + m[0] + '" → UUID ' + uuid.substring(0, 30) + '...');
          } else {
            // 弹窗文本本身就是简短标签
            labelToUUID[popupText.trim()] = uuid;
            log('弹窗选项: "' + popupText.substring(0, 40) + '" → UUID ' + uuid.substring(0, 30) + '...');
          }
        }

        // 按 label 给每个 mention 分配 UUID
        for (var si = 0; si < segments.length; si++) {
          if (segments[si].type !== 'mention') continue;
          var segLabel = segments[si].label; // "图片1", "视频1" 等
          if (segLabel && labelToUUID[segLabel]) {
            segments[si].uuid = labelToUUID[segLabel];
            log('mention "' + (segments[si].value || '').substring(0, 20) + '" → label "' + segLabel + '" → UUID ✓');
          } else {
            // 回退: 按索引取 (如弹窗只有1项且只有1个mention)
            log('mention "' + (segments[si].value || '').substring(0, 20) + '" → label "' + segLabel + '" 未在弹窗中找到');
          }
        }
      }

      try {
        // 重新获取 view (可能被弹窗操作影响)
        view = findPMView(ed);
        if (!view) {
          emitResult(eventName, { success: false, error: 'no PM view after UUID read' });
          return;
        }
        schema = view.state.schema;
        mentionType = schema.nodes['reference-mention-tag'];

        var inlineNodes = [];
        for (var si = 0; si < segments.length; si++) {
          var seg = segments[si];
          if (seg.type === 'text' && seg.value) {
            inlineNodes.push(schema.text(seg.value));
          } else if (seg.type === 'mention') {
            if (!seg.uuid) {
              // 没有 UUID, 作为普通文本插入
              warn('mention "' + (seg.label || seg.value) + '" 没有 UUID, 作为文本插入');
              inlineNodes.push(schema.text('@' + (seg.label || seg.value)));
              continue;
            }
            try {
              // 只传 id (UUID), 网站会自动根据 UUID 渲染正确的 图片N 标签
              var attrs = { id: seg.uuid };
              log('创建 mention: label="' + seg.label + '" id=' + seg.uuid.substring(0, 40) + '...');
              var mNode = mentionType.create(attrs);
              inlineNodes.push(mNode);
            } catch (e) {
              warn('创建 mention 节点失败:', e.message);
              inlineNodes.push(schema.text('@' + (seg.label || seg.value)));
            }
          }
        }

        if (inlineNodes.length === 0) {
          emitResult(eventName, { success: false, error: 'no inline nodes' });
          return;
        }

        var newPara = schema.nodes.paragraph.create(null, inlineNodes);
        var tr2 = view.state.tr;
        tr2 = tr2.replaceWith(0, view.state.doc.content.size, newPara);
        view.dispatch(tr2);
        view.focus();

        var mentionCount = 0, uuidCount = 0;
        for (var si = 0; si < segments.length; si++) {
          if (segments[si].type === 'mention') {
            mentionCount++;
            if (segments[si].uuid) uuidCount++;
          }
        }
        log('✅ 文档构建成功, mention=' + mentionCount + ', uuid=' + uuidCount);
        log('编辑器内容:', (ed.textContent || '').substring(0, 120));

        emitResult(eventName, {
          success: true,
          text: ed.textContent,
          html: (ed.innerHTML || '').substring(0, 500),
          mentionCount: mentionCount,
          uuidCount: uuidCount
        });
      } catch (err) {
        warn('构建文档错误:', err.message, err.stack);
        emitResult(eventName, { success: false, error: err.message });
      }
    }

    // 开始轮询
    setTimeout(pollAndBuild, 500);
  }

  // ============ 文件上传处理 (MAIN world) ============
  // 在 MAIN world 中执行文件上传，因为 React 的 __reactProps$ onChange 只在 MAIN world 可见

  function handleFileUpload(filesData, eventName) {
    try {
      // Step 1: 找到文件 input
      var fileInputs = document.querySelectorAll('input[type="file"]');
      var targetInput = null;

      for (var i = 0; i < fileInputs.length; i++) {
        var inp = fileInputs[i];
        var accept = (inp.getAttribute('accept') || '').toLowerCase();
        if (accept.indexOf('image') >= 0) {
          targetInput = inp;
          log('找到图片文件 input, accept=' + accept);
          break;
        }
      }

      if (!targetInput && fileInputs.length > 0) {
        targetInput = fileInputs[0];
        log('使用第一个文件 input (accept=' + (targetInput.getAttribute('accept') || 'none') + ')');
      }

      if (!targetInput) {
        warn('未找到文件 input');
        emitResult(eventName, { success: false, error: 'no file input found' });
        return;
      }

      // Step 2: 将 base64 数据转为 File 对象
      var files = [];
      for (var fi = 0; fi < filesData.length; fi++) {
        var fd = filesData[fi];
        try {
          var byteChars = atob(fd.base64);
          var byteArray = new Uint8Array(byteChars.length);
          for (var bi = 0; bi < byteChars.length; bi++) {
            byteArray[bi] = byteChars.charCodeAt(bi);
          }
          var blob = new Blob([byteArray], { type: fd.mimeType || 'image/png' });
          var file = new File([blob], fd.name || ('image_' + fi + '.png'), {
            type: fd.mimeType || 'image/png',
            lastModified: Date.now()
          });
          files.push(file);
          log('创建 File 对象: ' + file.name + ' (' + file.size + ' bytes, ' + file.type + ')');
        } catch (fe) {
          warn('创建 File[' + fi + '] 失败:', fe.message);
        }
      }

      if (files.length === 0) {
        warn('没有成功创建任何 File 对象');
        emitResult(eventName, { success: false, error: 'no files created' });
        return;
      }

      // Step 3: 用 DataTransfer 设置 files
      var dt = new DataTransfer();
      for (var di = 0; di < files.length; di++) {
        dt.items.add(files[di]);
      }

      // 使用原生 setter 设置 files 属性
      var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set;
      nativeSetter.call(targetInput, dt.files);
      log('已通过 native setter 设置 ' + dt.files.length + ' 个文件');

      // Step 4: 通过 React 内部属性直接调用 onChange
      var reactOnChangeCalled = false;
      var reactKeys = Object.keys(targetInput);
      for (var rk = 0; rk < reactKeys.length; rk++) {
        var key = reactKeys[rk];
        if (key.startsWith('__reactProps$') || key.startsWith('__reactProps')) {
          var props = targetInput[key];
          if (props && typeof props.onChange === 'function') {
            log('找到 React props onChange, 直接调用...');
            try {
              // 构造一个模拟的 React change event
              props.onChange({
                target: targetInput,
                currentTarget: targetInput,
                type: 'change',
                bubbles: true,
                preventDefault: function() {},
                stopPropagation: function() {},
                nativeEvent: new Event('change', { bubbles: true }),
                _reactName: 'onChange',
                isDefaultPrevented: function() { return false; },
                isPropagationStopped: function() { return false; }
              });
              reactOnChangeCalled = true;
              log('✅ React onChange 调用成功');
            } catch (re) {
              warn('React onChange 调用失败:', re.message);
            }
            break;
          }
        }
      }

      // Step 5: 如果没找到 React onChange，尝试通过 fiber 找
      if (!reactOnChangeCalled) {
        log('未在 __reactProps$ 中找到 onChange，尝试通过 fiber 查找...');
        for (var rk2 = 0; rk2 < reactKeys.length; rk2++) {
          var key2 = reactKeys[rk2];
          if (key2.startsWith('__reactFiber$') || key2.startsWith('__reactInternalInstance')) {
            var fiber = targetInput[key2];
            // 向上遍历 fiber 树查找 onChange
            for (var depth = 0; depth < 15 && fiber; depth++) {
              var p = fiber.memoizedProps || fiber.pendingProps;
              if (p && typeof p.onChange === 'function') {
                log('在 fiber 第 ' + depth + ' 层找到 onChange');
                try {
                  p.onChange({
                    target: targetInput,
                    currentTarget: targetInput,
                    type: 'change',
                    bubbles: true,
                    preventDefault: function() {},
                    stopPropagation: function() {}
                  });
                  reactOnChangeCalled = true;
                  log('✅ 通过 fiber onChange 调用成功');
                } catch (re2) {
                  warn('fiber onChange 调用失败:', re2.message);
                }
                break;
              }
              fiber = fiber.return;
            }
            if (reactOnChangeCalled) break;
          }
        }
      }

      // Step 6: 只在 React onChange 未成功时才派发原生事件 (fallback)
      if (!reactOnChangeCalled) {
        targetInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: false }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: false }));
        log('已派发 change + input 事件 (fallback)');

        // Step 7: 尝试 drop 事件
        log('尝试 drop 事件方式上传...');
        var uploadContainer = targetInput.closest('[class*="upload"]') || targetInput.parentElement;
        if (uploadContainer) {
          var dropDt = new DataTransfer();
          for (var ddi = 0; ddi < files.length; ddi++) {
            dropDt.items.add(files[ddi]);
          }
          var dropEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: dropDt
          });
          uploadContainer.dispatchEvent(dropEvent);
          log('已向上传区域派发 drop 事件');
        }
      }

      // 上传完成后，移除焦点避免触发 tooltip
      if (targetInput) targetInput.blur();
      var activeEl = document.activeElement;
      if (activeEl && activeEl !== document.body) activeEl.blur();

      log('文件上传处理完成, reactOnChange=' + reactOnChangeCalled + ', files=' + files.length);
      emitResult(eventName, {
        success: true,
        fileCount: files.length,
        reactOnChangeCalled: reactOnChangeCalled
      });

    } catch (err) {
      warn('文件上传处理失败:', err.message, err.stack);
      emitResult(eventName, { success: false, error: err.message });
    }
  }

  // ============================================================
  // 通用: 尝试通过 React props 触发 onClick
  // ============================================================
  function tryReactClick(el) {
    if (!el) return false;
    var reactKey = Object.keys(el).find(function(k) { return k.indexOf('__reactProps$') === 0; });
    if (reactKey && el[reactKey] && el[reactKey].onClick) {
      el[reactKey].onClick({
        preventDefault: function() {},
        stopPropagation: function() {},
        nativeEvent: new MouseEvent('click')
      });
      return true;
    }
    // 也尝试子元素
    var children = el.querySelectorAll('*');
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var ck = Object.keys(child).find(function(k) { return k.indexOf('__reactProps$') === 0; });
      if (ck && child[ck] && child[ck].onClick) {
        child[ck].onClick({
          preventDefault: function() {},
          stopPropagation: function() {},
          nativeEvent: new MouseEvent('click')
        });
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // 通用: hover 卡片容器以显示 button-groups
  // ============================================================
  function hoverCardContainer(record) {
    var cardContainer = record.querySelector('[class*="slot-card-container"]');
    if (!cardContainer) {
      cardContainer = record.closest('[class*="slot-card-container"]');
    }
    if (!cardContainer) return null;
    cardContainer.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    cardContainer.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    var cRect = cardContainer.getBoundingClientRect();
    cardContainer.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: cRect.x + cRect.width / 2, clientY: cRect.y + cRect.height / 2
    }));
    return cardContainer;
  }

  // ============================================================
  // 原生下载: hover 卡片 → 找 button-group-top 中的下载按钮
  // ============================================================
  function handleNativeDownload(recordSelector, eventName) {
    try {
      var record = document.querySelector(recordSelector);
      if (!record) {
        emitResult(eventName, { success: false, error: '未找到视频记录元素' });
        return;
      }

      var cardContainer = hoverCardContainer(record);
      if (!cardContainer) {
        emitResult(eventName, { success: false, error: '未找到卡片容器 (slot-card-container)' });
        return;
      }

      log('hover 卡片容器以触发 button-groups...');

      // 等待 button-groups 出现
      setTimeout(function() {
        // 查找 button-group-top (下载按钮所在分组)
        var topGroup = cardContainer.querySelector('[class*="button-group-"][class*="top"]');
        if (!topGroup) {
          // 回退: 尝试找到任何 button-group
          topGroup = cardContainer.querySelector('[class*="button-group-"]');
        }

        if (topGroup) {
          // 下载按钮 = top group 中第一个 action-button (非 split-line)
          var buttons = topGroup.children;
          var downloadBtn = null;

          // 优先通过 SVG path 识别 (下载箭头图标)
          var DOWNLOAD_SVG_PREFIX = 'M12 2a1 1 0 0 1 1 1v10.312';
          for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var cls = btn.className ? btn.className.toString() : '';
            if (cls.indexOf('split-line') >= 0) continue;
            var svgPath = btn.querySelector('svg path[d]');
            if (svgPath && svgPath.getAttribute('d').indexOf(DOWNLOAD_SVG_PREFIX) === 0) {
              downloadBtn = btn;
              break;
            }
          }

          // 回退: 第一个非 split-line 的 action-button
          if (!downloadBtn) {
            for (var j = 0; j < buttons.length; j++) {
              var b = buttons[j];
              var c = b.className ? b.className.toString() : '';
              if (c.indexOf('split-line') >= 0) continue;
              if (b.offsetWidth > 5) {
                downloadBtn = b;
                break;
              }
            }
          }

          if (downloadBtn) {
            log('找到下载按钮, 尝试点击...');
            // 尝试点击 operation-button 或 action-button
            var opBtn = downloadBtn.querySelector('[class*="operation-button"]') || downloadBtn;
            // 方法1: React onClick
            var clicked = tryReactClick(opBtn) || tryReactClick(downloadBtn);
            if (clicked) {
              log('通过 React onClick 触发下载');
              emitResult(eventName, { success: true, method: 'react-onclick' });
              return;
            }
            // 方法2: dispatchEvent 完整点击链
            log('通过 dispatchEvent 触发下载');
            opBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            opBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            opBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            emitResult(eventName, { success: true, method: 'dispatch-click' });
            return;
          }
        }

        log('未找到下载按钮, 尝试获取视频 URL');
        var videoEl = record.querySelector('video');
        var videoSrc = videoEl ? (videoEl.src || '') : '';
        if (videoSrc) {
          emitResult(eventName, { success: false, fallbackUrl: videoSrc, error: '未找到下载按钮' });
        } else {
          emitResult(eventName, { success: false, error: '未找到下载按钮和视频URL' });
        }
      }, 800);

    } catch (err) {
      warn('原生下载处理失败:', err.message);
      emitResult(eventName, { success: false, error: err.message });
    }
  }

  // ============================================================
  // 提升分辨率: hover 卡片 → 找 button-group-bottom 中的提升分辨率按钮
  // ============================================================
  function handleUpscaleClick(recordSelector, eventName) {
    try {
      var record = document.querySelector(recordSelector);
      if (!record) {
        emitResult(eventName, { success: false, error: '未找到视频记录元素' });
        return;
      }

      var cardContainer = hoverCardContainer(record);
      if (!cardContainer) {
        emitResult(eventName, { success: false, error: '未找到卡片容器 (slot-card-container)' });
        return;
      }

      log('hover 卡片容器以触发 button-groups (提升分辨率)...');

      // 等待 button-groups 出现
      setTimeout(function() {
        // 查找 button-group-bottom (提升分辨率按钮所在分组)
        var bottomGroup = cardContainer.querySelector('[class*="button-group-"][class*="bottom"]');
        if (!bottomGroup) {
          // 尝试查找任何 button-group (不含 top)
          var allGroups = cardContainer.querySelectorAll('[class*="button-group-"]');
          for (var g = 0; g < allGroups.length; g++) {
            var cls = allGroups[g].className ? allGroups[g].className.toString() : '';
            if (cls.indexOf('top') < 0) {
              bottomGroup = allGroups[g];
              break;
            }
          }
        }

        if (!bottomGroup) {
          emitResult(eventName, { success: false, error: '未找到底部按钮组 (button-group-bottom)' });
          return;
        }

        // 在 bottom group 中找提升分辨率按钮
        // 通过 SVG path 识别 (分辨率图标)
        var UPSCALE_SVG_PREFIX = 'M17.611 3.5A4.89';
        var upscaleBtn = null;
        var buttons = bottomGroup.children;

        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          var bcls = btn.className ? btn.className.toString() : '';
          if (bcls.indexOf('split-line') >= 0) continue;
          var svgPath = btn.querySelector('svg path[d]');
          if (svgPath && svgPath.getAttribute('d').indexOf(UPSCALE_SVG_PREFIX) === 0) {
            upscaleBtn = btn;
            break;
          }
        }

        if (!upscaleBtn) {
          // 回退: 第4个按钮 (索引3, 跳过 split-line)
          var btnIndex = 0;
          for (var j = 0; j < buttons.length; j++) {
            var b = buttons[j];
            var c = b.className ? b.className.toString() : '';
            if (c.indexOf('split-line') >= 0) continue;
            if (btnIndex === 3) {
              upscaleBtn = b;
              break;
            }
            btnIndex++;
          }
        }

        if (!upscaleBtn) {
          emitResult(eventName, { success: false, error: '未找到提升分辨率按钮' });
          return;
        }

        // 检查是否 disabled
        var upscaleCls = upscaleBtn.className ? upscaleBtn.className.toString() : '';
        var hasDisabled = upscaleCls.indexOf('disabled') >= 0 || !!upscaleBtn.querySelector('[class*="disabled"]');
        if (hasDisabled) {
          emitResult(eventName, { success: false, error: '视频已达到最高分辨率，无法再提升' });
          return;
        }

        log('找到提升分辨率按钮, 尝试点击...');
        var opBtn = upscaleBtn.querySelector('[class*="operation-button"]') || upscaleBtn;
        var clicked = tryReactClick(opBtn) || tryReactClick(upscaleBtn);
        if (clicked) {
          log('通过 React onClick 触发提升分辨率');
          emitResult(eventName, { success: true, message: '已触发提升分辨率' });
          return;
        }

        // dispatchEvent 回退
        log('通过 dispatchEvent 触发提升分辨率');
        opBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        opBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        opBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        emitResult(eventName, { success: true, message: '已点击提升分辨率按钮' });
      }, 800);

    } catch (err) {
      warn('提升分辨率处理失败:', err.message);
      emitResult(eventName, { success: false, error: err.message });
    }
  }

  log('MAIN world 脚本已加载');
})();
