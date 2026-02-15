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
    if (!e.data || e.data.type !== 'seedance-build-mention-doc') return;
    var segments = e.data.segments;
    var eventName = e.data.eventName;
    log('收到 mention 构建请求, segments=' + segments.length + ', eventName=' + eventName);
    buildMentionDoc(segments, eventName);
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
    // 使用 PM 的 insertText 命令触发 TipTap suggestion
    try {
      var tr = view.state.tr.insertText('@', view.state.selection.from);
      view.dispatch(tr);
      log('已通过 PM API 输入 @，等待弹窗...');
    } catch (e) {
      warn('PM insertText @ 失败:', e.message, '尝试 execCommand...');
      document.execCommand('insertText', false, '@');
      log('已通过 execCommand 输入 @，等待弹窗...');
    }

    // Step 4: 轮询弹窗
    var attempts = 0;

    function pollAndBuild() {
      attempts++;
      var popup = null;
      var listboxes = document.querySelectorAll('[role="listbox"]');
      for (var i = 0; i < listboxes.length; i++) {
        var t = listboxes[i].textContent || '';
        if (t.indexOf('图片') >= 0 || t.indexOf('视频') >= 0) {
          var opts = listboxes[i].querySelectorAll('[role="option"], li.lv-select-option');
          if (opts.length > 0) { popup = listboxes[i]; break; }
        }
      }

      if (popup) {
        log('找到 @ 弹窗, 开始读取 UUID...');
        // 读取 UUID
        var opts = popup.querySelectorAll('[role="option"], li.lv-select-option');
        var ids = [];
        for (var oi = 0; oi < opts.length; oi++) {
          var opt = opts[oi];
          var label = (opt.textContent || '').trim();
          var uuid = null;
          var fk = Object.keys(opt).find(function(k) {
            return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance');
          });
          if (fk) {
            var f = opt[fk];
            for (var fi = 0; fi < 10 && f; fi++) {
              var p = f.memoizedProps || f.pendingProps;
              if (p && p.value && typeof p.value === 'string' && p.value.length > 20) {
                uuid = p.value; break;
              }
              f = f.return;
            }
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
          var stillOpen = document.querySelectorAll('[role="listbox"]');
          for (var si = 0; si < stillOpen.length; si++) {
            var t = stillOpen[si].textContent || '';
            if (t.indexOf('图片') >= 0 || t.indexOf('视频') >= 0) {
              document.body.click();
              break;
            }
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
      } else if (attempts < 20) {
        if (attempts % 5 === 0) log('等待弹窗... (第' + attempts + '次尝试)');
        setTimeout(pollAndBuild, 300);
      } else {
        warn('@ 弹窗未出现 (20次尝试)，直接构建文档 (无 UUID)');
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
      // 分配 UUID
      if (ids && ids.length > 0) {
        for (var si = 0; si < segments.length; si++) {
          if (segments[si].type === 'mention' && segments[si].fileIndex !== undefined) {
            var ref = ids[segments[si].fileIndex];
            if (ref && ref.id) segments[si].uuid = ref.id;
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
            var mentionId = seg.uuid || String(seg.fileIndex);
            try {
              var mNode = mentionType.create({ id: mentionId });
              inlineNodes.push(mNode);
            } catch (e) {
              warn('创建 mention 节点失败:', e.message);
              // fallback: 插入占位文本
              inlineNodes.push(schema.text('[' + (seg.label || '?') + ']'));
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

  log('MAIN world 脚本已加载');
})();
